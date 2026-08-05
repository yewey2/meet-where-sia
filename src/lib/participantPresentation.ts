export function participantIdentityPresentation(
  index: number,
  displayName: string,
  isCurrentUser: boolean,
) {
  return {
    className: `participant-card${isCurrentUser ? ' is-current-user' : ''}`,
    ariaLabel: `Person ${index + 1}: ${displayName}${isCurrentUser ? ' (You)' : ''}`,
    badge: isCurrentUser ? 'Your route' : null,
  };
}
