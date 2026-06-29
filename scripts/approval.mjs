// scripts/approval.mjs — pure approval-set mutation for studio/approved.json. setApproval returns
// a NEW { approved: string[] } with `name` added (approved=true, no duplicate) or removed (false),
// never mutating the input. Imported by the engine's POST /api/approval write surface.

export function setApproval(approvedObj, name, approved) {
  const list = (approvedObj && Array.isArray(approvedObj.approved)) ? approvedObj.approved : [];
  const next = list.filter((n) => n !== name);   // drop any existing copy (prevents duplicates)
  if (approved) next.push(name);
  return { ...approvedObj, approved: next };
}
