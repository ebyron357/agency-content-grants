export function rejectsSectionContentMutation(
  section: { isLocked: boolean; isApproved: boolean },
  body: Record<string, unknown>,
): boolean {
  return (
    (section.isLocked || section.isApproved) &&
    Object.prototype.hasOwnProperty.call(body, "content")
  );
}
