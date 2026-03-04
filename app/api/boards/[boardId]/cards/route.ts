import { NextRequest, NextResponse } from 'next/server';
import { getTrelloCredentials } from '@/lib/trello-auth';

const TRELLO_BASE = 'https://api.trello.com/1';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ boardId: string }> }
) {
  const { boardId } = await params;
  const { apiKey, token } = getTrelloCredentials(request.headers);

  if (!apiKey || !token) {
    return NextResponse.json({ error: 'Missing credentials' }, { status: 401 });
  }

  const includeClosed = request.nextUrl.searchParams.get('include_closed') === 'true';
  const filterVal = includeClosed ? 'all' : 'open';

  const [cardsRes, listsRes] = await Promise.all([
    fetch(
      `${TRELLO_BASE}/boards/${boardId}/cards?key=${apiKey}&token=${token}` +
        `&filter=${filterVal}&fields=id,name,desc,idList,labels,due,dueComplete,url,shortUrl,closed,idMembers` +
        `&attachments=false&checklists=none&members=true&member_fields=fullName,avatarHash,initials`
    ),
    fetch(
      `${TRELLO_BASE}/boards/${boardId}/lists?key=${apiKey}&token=${token}&fields=id,name&filter=open`
    ),
  ]);

  if (!cardsRes.ok) {
    return NextResponse.json({ error: `Trello error: ${cardsRes.status}` }, { status: cardsRes.status });
  }

  const cards = await cardsRes.json();
  const lists = listsRes.ok ? await listsRes.json() : [];

  const listMap: Record<string, string> = {};
  lists.forEach((l: { id: string; name: string }) => {
    listMap[l.id] = l.name;
  });
  cards.forEach((c: { idList: string; listName?: string }) => {
    c.listName = listMap[c.idList] || 'Unknown';
  });

  return NextResponse.json({ cards, lists });
}
