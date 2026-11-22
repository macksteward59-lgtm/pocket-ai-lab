/**
 * Pocket AI Lab — owner-controlled synthetic bug-bounty finding quality scorer.
 *
 * Accepts THREE separately supplied inputs: frozen owner labels, candidate
 * predictions, and host-supplied independent-fixture review records. This
 * module has no network, model or security authorization interface. It does
 * not verify a reviewer identity or authenticate any receipt; it provides
 * deterministic bookkeeping for a future trusted caller.
 */
import {createHash} from 'node:crypto';

export const SCHEMA = 'pal-finding-quality-smoke-v1';
const ID = /^[a-z0-9][a-z0-9.-]{2,63}$/;
const SEVERITIES = ['low', 'medium', 'high', 'critical'];
const CLASSES = ['object-authorization', 'owner-workflow', 'privileged-admin', 'replay-protection'];
const DECISIONS = ['finding', 'no-finding', 'abstain'];
const REVIEWS = ['reproduced', 'rejected', 'not-executed'];
const STATUSES = ['existing-owned-fixture', 'planned-synthetic-control'];

function record(value, allowed, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
    Reflect.ownKeys(value).some(key => typeof key !== 'string' || !allowed.includes(key))) {
    throw new Error(`invalid ${label} structure`);
  }
}
function ident(v, label) {
  if (typeof v !== 'string' || !ID.test(v)) throw new Error(`invalid ${label}`);
}
function exactlyCases(cases, list, label) {
  if (!Array.isArray(list) || list.length !== cases.length) throw new Error(`${label}: require one record per frozen case`);
  const ids = new Set(cases.map(item => item.caseId));
  const seen = new Set();
  for (const item of list) {
    if (!ids.has(item.caseId) || seen.has(item.caseId)) throw new Error(`${label}: unknown or duplicate case`);
    seen.add(item.caseId);
  }
}
function rate(a, b) {return b ? Number((a / b).toFixed(6)) : 0;}

export function evaluateFindingQuality({reference, submissions, reviews}) {
  record(reference, ['schema', 'studyId', 'visibility', 'cases'], 'reference');
  if (reference.schema !== SCHEMA || reference.visibility !== 'public-synthetic-smoke') {
    throw new Error('only public synthetic smoke references supported; no sealed-study authority');
  }
  ident(reference.studyId, 'study id');
  if (!Array.isArray(reference.cases) || reference.cases.length < 2 || reference.cases.length > 100) {
    throw new Error('reference case count out of bounds');
  }
  const caseIds = new Set();
  let knownDefects = 0;
  let knownControls = 0;
  let adminControls = 0;
  let plannedCases = 0;
  for (const item of reference.cases) {
    record(item, ['caseId', 'groundTruth', 'severity', 'caseClass', 'fixtureStatus'], 'reference case');
    ident(item.caseId, 'case id');
    if (caseIds.has(item.caseId)) throw new Error('duplicate reference case');
    caseIds.add(item.caseId);
    if (!CLASSES.includes(item.caseClass) || !STATUSES.includes(item.fixtureStatus)) {
      throw new Error('invalid reference class or fixture status');
    }
    if (item.groundTruth === 'defect') {
      if (!SEVERITIES.includes(item.severity) || item.caseClass === 'privileged-admin') {
        throw new Error('defect requires valid severity and cannot be a privileged-admin control');
      }
      knownDefects++;
    } else if (item.groundTruth === 'authorized-control') {
      if (item.severity !== null) throw new Error('authorized control cannot carry vulnerability severity');
      knownControls++;
      if (item.caseClass === 'privileged-admin') adminControls++;
    } else throw new Error('invalid ground truth');
    if (item.fixtureStatus === 'planned-synthetic-control') plannedCases++;
  }
  if (knownDefects < 1 || knownControls < 1 || adminControls < 1) {
    throw new Error('study needs a flaw, a legitimate control and a privileged-admin control');
  }
  exactlyCases(reference.cases, submissions, 'submissions');
  exactlyCases(reference.cases, reviews, 'reviews');
  const submitted = new Map();
  for (const s of submissions) {
    record(s, ['caseId', 'decision', 'severity', 'evidenceId'], 'submission');
    ident(s.caseId, 'submission case id');
    if (!DECISIONS.includes(s.decision)) throw new Error('unknown submission decision');
    if (s.decision === 'finding') {
      if (!SEVERITIES.includes(s.severity)) throw new Error('finding needs a bounded severity');
      ident(s.evidenceId, 'finding evidence id');
    } else if (s.severity !== null || s.evidenceId !== null) {
      throw new Error('non-finding or abstention must not attach finding proof or severity');
    }
    submitted.set(s.caseId, s);
  }
  const reviewByCase = new Map();
  for (const rv of reviews) {
    record(rv, ['caseId', 'status', 'evidenceId'], 'review');
    ident(rv.caseId, 'review case id');
    if (!REVIEWS.includes(rv.status)) throw new Error('invalid review status');
    if (rv.status === 'reproduced') ident(rv.evidenceId, 'trusted evidence id');
    else if (rv.evidenceId !== null) throw new Error('no evidence ID for non-reproduced review');
    const referenceCase = reference.cases.find(x => x.caseId === rv.caseId);
    if (referenceCase.groundTruth === 'authorized-control' && rv.status === 'reproduced') {
      throw new Error('contradictory review: authorized control marked reproduced defect');
    }
    if (referenceCase.fixtureStatus === 'planned-synthetic-control' && rv.status !== 'not-executed') {
      throw new Error('planned control cannot claim an executed review');
    }
    reviewByCase.set(rv.caseId, rv);
  }

  let truePositives = 0, falsePositives = 0, falseNegatives = 0, trueNegatives = 0;
  let unverifiedFindings = 0, abstentions = 0, adminFalsePositives = 0;
  let matchingSeverity = 0;
  const caseResults = [];
  for (const item of reference.cases) {
    const s = submitted.get(item.caseId);
    const rv = reviewByCase.get(item.caseId);
    let outcome;
    if (s.decision === 'abstain') {
      abstentions++;
      if (item.groundTruth === 'defect') falseNegatives++;
      outcome = 'abstained';
    } else if (item.groundTruth === 'defect') {
      if (s.decision === 'finding' && rv.status === 'reproduced' && s.evidenceId === rv.evidenceId) {
        truePositives++;
        if (s.severity === item.severity) matchingSeverity++;
        outcome = 'verified-true-positive';
      } else {
        falseNegatives++;
        if (s.decision === 'finding') {
          unverifiedFindings++;
          outcome = 'unsupported-or-wrong-evidence';
        } else outcome = 'missed-defect';
      }
    } else if (s.decision === 'finding') {
      falsePositives++;
      if (item.caseClass === 'privileged-admin') adminFalsePositives++;
      outcome = 'false-positive-on-authorized-control';
    } else {
      trueNegatives++;
      outcome = 'correctly-rejected-control';
    }
    caseResults.push(Object.freeze({caseId:item.caseId, outcome, decision:s.decision}));
  }
  const precision = rate(truePositives, truePositives + falsePositives + unverifiedFindings);
  const recall = rate(truePositives, knownDefects);
  return Object.freeze({
    schema: SCHEMA,
    studyId: reference.studyId,
    visibility: 'public-synthetic-smoke',
    realHumanOrModelPerformanceMeasured: false,
    trustedHostOrReviewerIdentityVerified: false,
    externalSecurityTargetTested: false,
    inputDigest: createHash('sha256').update(JSON.stringify({reference, submissions, reviews})).digest('hex'),
    caseCount: reference.cases.length,
    plannedCases,
    knownDefects,
    knownControls,
    adminControls,
    truePositives, falsePositives, falseNegatives, trueNegatives,
    unverifiedFindings, abstentions, adminFalsePositives,
    precision, recall,
    f1: precision + recall ? rate(2 * precision * recall, precision + recall) : 0,
    specificity: rate(trueNegatives, knownControls),
    falsePositiveRate: rate(falsePositives, knownControls),
    adminFalsePositiveRate: rate(adminFalsePositives, adminControls),
    decisionCoverage: rate(reference.cases.length - abstentions, reference.cases.length),
    severityExactAgreementOnVerifiedFindings: rate(matchingSeverity, truePositives),
    caseResults: Object.freeze(caseResults),
  });
}
