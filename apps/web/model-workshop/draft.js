import { digest } from "./catalog.js";
import { readerReference, snapshotReader, verifyReader } from "./identity.js";

const format = "pocket-reader-draft-v1";
const formFields = ["method", "base", "second", "rightPercent", "name", "editorText", "parameterKey",
  "parameterText", "parameterPending"];
const parameter = /^(?:intercept|(?:biases|output)\.[0-7]|weights\.[0-7]\.[0-9])$/;

function exactFields(object, keys) {
  return object && typeof object === "object" && !Array.isArray(object) &&
    Object.keys(object).length === keys.length && keys.every(key => Object.hasOwn(object, key));
}

function parentRef(value) {
  if (!exactFields(value, ["id", "hash"])) throw Error("A draft parent requires an exact model ID and weight hash.");
  return Object.freeze(readerReference(value));
}

function editorState(source) {
  const { method, rightPercent, name, editorText, parameterKey, parameterText, parameterPending } = source;
  if (method !== "edit" && method !== "blend") throw Error("Choose a browser edit or blend before saving a draft.");
  const base = parentRef(source.base);
  let second = null;
  if (method === "blend") {
    second = parentRef(source.second);
    if (base.id === second.id || base.hash === second.hash) throw Error("Choose two distinct parent weights for a blend.");
    if (!Number.isInteger(rightPercent) || rightPercent < 1 || rightPercent > 99) {
      throw Error("A blend draft needs a whole second-parent percentage from 1 through 99.");
    }
  } else if (rightPercent !== null || source.second !== null) {
    throw Error("A single-parent draft cannot include a second model or a blend percentage.");
  }
  if (typeof name !== "string" || name.length > 64 || /[\r\n]/.test(name)) {
    throw Error("The candidate name must fit on one line of up to 64 characters.");
  }
  if (typeof editorText !== "string" || editorText.length > 65536) {
    throw Error("The draft weights editor supports up to 65,536 characters.");
  }
  if (typeof parameterPending !== "boolean" || typeof parameterText !== "string" ||
      parameterText.length > 128 || /[\r\n]/.test(parameterText)) throw Error("Invalid unapplied parameter input.");
  if (typeof parameterKey !== "string" || (parameterKey ? !parameter.test(parameterKey) : parameterPending || parameterText !== "")) {
    throw Error("Choose a valid v1 reader parameter.");
  }
  // Keep the editor verbatim. Drafts can be incomplete and never grant a candidate a review result.
  return { format, method, base, second, rightPercent, name, editorText, parameterKey, parameterText, parameterPending };
}

async function seal(state, catalog, expectedId) {
  const parents = [state.base, state.second].filter(Boolean).map(ref => snapshotReader(catalog, ref.id, ref.hash));
  const bytes = new TextEncoder().encode(JSON.stringify(state));
  const [hash] = await Promise.all([digest(bytes), ...parents.map(verifyReader)]);
  const id = "draft-" + hash;
  if (expectedId !== undefined && id !== expectedId) throw Error("The saved draft content differs from its snapshot ID.");
  return Object.freeze({ ...state, id });
}

export async function createDraft(form, catalog) {
  if (!exactFields(form, formFields)) throw Error("The form contains missing or unsupported draft fields.");
  return seal(editorState(form), catalog);
}

export async function restoreDraft(record, catalog) {
  if (!exactFields(record, ["format", "id", ...formFields]) || record.format !== format ||
      typeof record.id !== "string" || !/^draft-[a-f0-9]{64}$/.test(record.id)) {
    throw Error("Choose a supported browser reader draft snapshot.");
  }
  return seal(editorState(record), catalog, record.id);
}
