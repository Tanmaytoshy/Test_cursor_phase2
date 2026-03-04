export function getTrelloCredentials(headers: Headers): { apiKey: string; token: string } {
  const apiKey = headers.get('X-Trello-Key') || process.env.TRELLO_KEY || '';
  const token = headers.get('X-Trello-Token') || process.env.TRELLO_TOKEN || '';
  return { apiKey, token };
}

