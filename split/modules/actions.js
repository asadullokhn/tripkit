import { state, API } from "./state.js";
import { $, api, toast, pushDoc, showSpinner, hideSpinner } from "./core.js";
import { compute, settle } from "./render.js";
import { confirmAsk, clearErr, openDialog, closeDialog, busy } from "./dialogs.js";

export async function publishSettlement() {
  const live = settle(compute().net);
  if (!live.length) { toast(I18N.t("split.toast.nothingToSettle", "Nothing to settle"), { type: "err" }); return; }
  const ok = await confirmAsk({ title: I18N.t("split.confirm.publishTitle", "Publish settlement plan?"), okLabel: I18N.t("split.settle.publishShort", "Publish"),
    body: I18N.t("split.confirm.publishBody", "This freezes the current “who pays whom” as the official plan. Friends pay against it, and recording payments won’t reshuffle it.") });
  if (!ok) return;
  const transfers = live.map((t) => ({ fromId: t.from, toId: t.to, amount: t.amount }));
  pushDoc(api(`/trips/${state.tripId}/settlement`, { method: "PUT", body: { transfers } }), { okMsg: I18N.t("split.toast.published", "Settlement published") });
}
export async function regenerateSettlement() {
  const live = settle(compute().net);
  const ok = await confirmAsk({ title: I18N.t("split.confirm.regenTitle", "Re-generate the plan?"), danger: true, okLabel: I18N.t("split.settle.regenShort", "Re-generate"),
    body: I18N.t("split.confirm.regenBody", "Recompute who-pays-whom from current balances. Unchanged transfers keep their proof and verified status; changed ones reset.") });
  if (!ok) return;
  const transfers = live.map((t) => ({ fromId: t.from, toId: t.to, amount: t.amount }));
  pushDoc(api(`/trips/${state.tripId}/settlement`, { method: "PUT", body: { transfers } }), { okMsg: I18N.t("split.toast.regenerated", "Plan re-generated") });
}
export async function unpublishSettlement() {
  const ok = await confirmAsk({ title: I18N.t("split.confirm.unpublishTitle", "Unpublish the plan?"), danger: true, okLabel: I18N.t("split.settle.unpublish", "Unpublish"),
    body: I18N.t("split.confirm.unpublishBody", "Settlement goes back to live auto-calculation. Uploaded proofs and verifications on the plan are discarded.") });
  if (!ok) return;
  pushDoc(api(`/trips/${state.tripId}/settlement`, { method: "DELETE" }), { okMsg: I18N.t("split.toast.unpublished", "Plan unpublished") });
}
export function setVerify(tid, on) {
  pushDoc(api(`/trips/${state.tripId}/settlement/${tid}/${on ? "verify" : "unverify"}`, { method: "POST" }), { okMsg: on ? I18N.t("split.toast.verified", "Verified ✓") : I18N.t("split.toast.reopened", "Re-opened") });
}
// proof upload (shared hidden input; editor tier)
let proofTid = null;
export function uploadProof(tid) { proofTid = tid; $("#proofFile").click(); }
$("#proofFile").addEventListener("change", (e) => {
  const file = e.target.files && e.target.files[0]; e.target.value = "";
  if (!file || !proofTid) return;
  const tid = proofTid; proofTid = null;
  showSpinner(I18N.t("split.spinner.uploadingProof", "Uploading proof…"));
  const fd = new FormData(); fd.append("image", file);
  pushDoc(api(`/trips/${state.tripId}/settlement/${tid}/proof`, { method: "POST", body: fd }), { okMsg: I18N.t("split.toast.proofUploaded", "Proof uploaded"), errMsg: I18N.t("split.toast.uploadFailed", "Upload failed — try a smaller jpg/png") })
    .catch(() => {}).finally(() => hideSpinner());
});
// proof lightbox
export function openProof(tid) {
  const img = $("#lightboxImg");
  img.src = `${API}/trips/${state.tripId}/settlement/${tid}/proof?pass=${encodeURIComponent(state.pass)}`;
  $("#lightbox").hidden = false;
}
export function closeLightbox() { $("#lightbox").hidden = true; $("#lightboxImg").src = ""; }
$("#lightbox").addEventListener("click", closeLightbox);
$("#lightboxClose").addEventListener("click", closeLightbox);
document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("#lightbox").hidden) closeLightbox(); });
// bank/payout dialog (editor tier)
const bankDialog = $("#bankDialog");
let bankPid = null;
export function openBank(p) {
  if (!p) return; bankPid = p.id;
  $("#bankTitle").textContent = I18N.t("split.bank.titleFor", "Payout details — {name}", { name: p.name });
  $("#bankInput").value = p.bankAccount || "";
  clearErr(bankDialog); openDialog(bankDialog, "#bankInput");
}
$("#bankCancel").addEventListener("click", () => closeDialog(bankDialog));
bankDialog.addEventListener("cancel", (ev) => { ev.preventDefault(); closeDialog(bankDialog); });
$("#bankForm").addEventListener("submit", (ev) => {
  ev.preventDefault();
  if (!bankPid) return;
  const v = $("#bankInput").value.trim(); const btn = $("#bankSave"); busy(btn, true);
  pushDoc(api(`/trips/${state.tripId}/people/${bankPid}/bank`, { method: "PUT", body: { bankAccount: v } }), { okMsg: I18N.t("split.toast.payoutSaved", "Payout saved") })
    .then(() => closeDialog(bankDialog)).catch(() => {}).finally(() => busy(btn, false));
});
