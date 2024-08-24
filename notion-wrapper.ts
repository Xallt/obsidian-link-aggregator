import { requestUrl } from 'obsidian';
import { LinkItem } from './common';

interface PublishTableResult {
  databaseId: string;
  databaseUrl: string;
  entriesAdded: number;
  createdTime: string;
  lastEditedTime: string;
  failedEntries: { item: LinkItem; error: string }[];
}

class PagePublishError extends Error {
  constructor(public item: LinkItem, message: string) {
    super(message);
    this.name = 'PagePublishError';
  }
}

export class NotionWrapper {
  private apiKey: string;
  private pageId: string;

  constructor(apiKey: string, pageId: string) {
    this.apiKey = apiKey;
    this.pageId = pageId;
  }

  getCurrentApiKey(): string {
    return this.apiKey;
  }

  async checkApiKeyValidity(): Promise<void> {
    try {
      const pageResponse = await requestUrl({
        url: `https://api.notion.com/v1/pages/${this.pageId}`,
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Notion-Version': '2022-06-28'
        }
      });
      if (pageResponse.status !== 200) {
        throw new Error('Page does not exist');
      }
      console.log('Page data:', pageResponse.json);
    } catch (error) {
      console.error('Error:', error);
      throw new Error('Invalid Notion API key or page ID');
    }
  }

  async publishTable(linkItems: LinkItem[], onProgress?: (item: LinkItem) => void, cancellationToken = { cancelled: false }): Promise<PublishTableResult> {
    try {
      if (cancellationToken.cancelled) throw new Error('Operation cancelled');
      const currentDate = new Date().toLocaleString();
      const tableName = `Obsidian Table Export - ${currentDate}`;
      console.log('Creating database');
      const requestData = {
        parent: { page_id: this.pageId },
        title: [{ type: 'text', text: { content: tableName } }],
        properties: {
          name: { type: 'title', title: {} },
          link: { type: 'url', url: {} },
          tags: { type: 'multi_select', multi_select: {} },
          description: { type: 'rich_text', rich_text: {} },
          type: { type: 'select', select: {} }
        }
      };

      if (cancellationToken.cancelled) throw new Error('Operation cancelled');
      const response = await requestUrl({
        url: 'https://api.notion.com/v1/databases',
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Notion-Version': '2022-06-28',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestData)
      });

      const databaseResponse = response.json;
      const databaseId = databaseResponse.id;
      console.log('Database created:', databaseId);

      const failedEntries: { item: LinkItem; error: string }[] = [];
      for (const item of linkItems) {
        if (cancellationToken.cancelled) throw new Error('Operation cancelled');
        try {
          console.log('Adding row:', item);
          await requestUrl({
            url: 'https://api.notion.com/v1/pages',
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${this.apiKey}`,
              'Notion-Version': '2022-06-28',
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              parent: { database_id: databaseId },
              properties: {
                name: { title: [{ text: { content: item.name } }] },
                link: { url: item.link },
                tags: { multi_select: item.tags.map(tag => ({ name: tag })) },
                description: { rich_text: [{ text: { content: item.description } }] },
                type: { select: { name: item.type } }
              }
            })
          });
          onProgress?.(item);
        } catch (error) {
          console.error(`Failed to add item: ${item.name}. Error: ${error.message}`);
          failedEntries.push({ item, error: error.message });
        }
      }

      console.log('Table published');
      return {
        databaseUrl: databaseResponse.url,
        entriesAdded: linkItems.length - failedEntries.length,
        databaseId: databaseResponse.id,
        createdTime: databaseResponse.created_time,
        lastEditedTime: databaseResponse.last_edited_time,
        failedEntries
      };
    } catch (error) {
      console.error('Error:', error);
      throw error;
    }
  }
}