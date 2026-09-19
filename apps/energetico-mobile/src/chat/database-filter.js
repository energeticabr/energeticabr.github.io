export function latestDatabaseFilter(messages = []) {
  const poll = [...messages]
    .reverse()
    .find(message => message?.role !== "user" && message?.type === "poll");
  if (poll?.databaseFilter !== true) return null;
  const key = String(poll.databaseFilterKey || "").trim();
  return key ? { key, message: poll } : null;
}
