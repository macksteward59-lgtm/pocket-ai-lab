import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {validatePublicProofRegister,validateRegisterFile} from './public-proof-register-v1.mjs';

const sample=JSON.parse(await readFile(new URL('./public-proof-register-v1.json',import.meta.url),'utf8'));
const copied=()=>structuredClone(sample);

test('public reference-only proof register validates without fetching sources', async ()=> {
  assert.equal((await validateRegisterFile()).ok,true);
  const result=validatePublicProofRegister(sample);
  assert.equal(result.ok,true);
  assert.equal(result.count,4);
  assert.equal(result.screenshotRightsVerified,false);
  assert.equal(result.modelResultsReproduced,false);
});
test('all cited records are explicitly not reproduced in Pocket AI Lab',()=>{
  assert.ok(sample.records.every(e=>e.independentPalReproduction==='not-performed'));
  assert.ok(sample.records.every(e=>e.notProven && e.candidateOwnedTest));
});
test('rejects untrusted structural additions carrying screenshots',()=>{
  const d=copied(); d.records[0].screenshotBase64='iVBORw0KGgo...';
  assert.equal(validatePublicProofRegister(d).ok,false);
});
test('rejects embedded Markdown images in notes',()=>{
  const d=copied();d.records[0].pocketLabLesson='Test image ![undisclosed](https://example.com/a.png) should not be copied';
  assert.equal(validatePublicProofRegister(d).ok,false);
});
test('rejects private/internal or raw screenshot URLs',()=>{
  for(const url of ['http://127.0.0.1:8000/a','https://intranet.example/x','https://github.com@evil.example/x','data:image/png;base64,abcd']){
    const d=copied();d.records[0].publicDemoUrl=url;
    assert.equal(validatePublicProofRegister(d).ok,false,url);
  }
});
test('rejects query-bearing evidence URLs that could contain secrets',()=>{
  const d=copied();d.records[1].additionalEvidenceUrl='https://github.com/KeygraphHQ/shannon?access_token=example';
  assert.equal(validatePublicProofRegister(d).ok,false);
});
test('rejects forged independent execution status',()=>{
  const d=copied();d.records[2].independentPalReproduction='verified';
  assert.equal(validatePublicProofRegister(d).ok,false);
});
test('rejects empty or duplicate stable source IDs',()=>{
  const d=copied();d.records[1].id=d.records[0].id;
  assert.equal(validatePublicProofRegister(d).ok,false);
});
test('rejects missing license or uncertainty fields',()=>{
  const d=copied(); delete d.records[0].codeLicenseUrl;
  assert.equal(validatePublicProofRegister(d).ok,false);
  const v=copied();v.records[0].notProven='';
  assert.equal(validatePublicProofRegister(v).ok,false);
});
test('rejects assigning rights merely because an image is public',()=>{
  const d=copied();d.records[0].imageRights='public domain assumed';
  assert.equal(validatePublicProofRegister(d).ok,false);
});
test('rejects credential-like contents in the research record',()=>{
  for(const secret of ['Bearer fake_secret','api_key=not-for-posting','password: secret']){
    const d=copied();d.records[0].sourceSupportedClaim='Sensitive value '+secret+' here';
    assert.equal(validatePublicProofRegister(d).ok,false,secret);
  }
});
test('does not accept missing root scope policy or extra binary payload',()=>{
  const d=copied();d.imageHandling='copy-all-public-screenshots';
  assert.equal(validatePublicProofRegister(d).ok,false);
  const v=copied();v.screenshotRaw='secret';
  assert.equal(validatePublicProofRegister(v).ok,false);
});
