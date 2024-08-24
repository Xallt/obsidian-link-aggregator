import { App, Plugin, PluginSettingTab, Setting, TFile, MarkdownView, Modal, Notice } from 'obsidian';
import { NotionWrapper } from './notion-wrapper';
import { LinkItem } from './common';

export default class PublishTablePlugin extends Plugin {
	settings: {
		notionApiKey: string;
		notionPageId: string;
	};
	notionWrapper: NotionWrapper;

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new PublishTableSettingTab(this.app, this));

		this.notionWrapper = new NotionWrapper(this.settings.notionApiKey, this.settings.notionPageId);
		try {
			await this.notionWrapper.checkApiKeyValidity();
		} catch (error) {
			console.error('Invalid Notion API key:', error);
		}

		this.addCommand({
			id: 'publish-link-aggregator',
			name: 'Publish Link Aggregator',
			callback: async () => {
				const files = this.app.vault.getFiles();
				const linkPages = files.filter(file => {
					if (file.path.startsWith('Templates/')) return false;
					const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
					const validTypes = ['tool', 'link', 'library', 'dataset'];
					return validTypes.includes(frontmatter?.type);
				});

				const linkItems: LinkItem[] = await Promise.all(linkPages.map(async (file) => {
					const content = await this.app.vault.read(file);
					const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter;
					const linkedFiles = this.app.metadataCache.resolvedLinks[file.path] || {};
					const tags = Object.keys(linkedFiles).map(path => this.app.metadataCache.getFirstLinkpathDest(path, file.path)?.basename).filter((tag): tag is string => tag !== undefined);
					return {
						name: file.basename,
						link: frontmatter?.link || '',
						tags,
						description: this.getDescription(content),
						type: frontmatter?.type || ''
					};
				}));

				const modal = new Modal(this.app);
				modal.contentEl.createEl('h2', {text: 'Publishing Table to Notion'});
				const progressBar = modal.contentEl.createEl('progress', {attr: {value: 0, max: linkItems.length}});
				const cancelButton = modal.contentEl.createEl('button', {text: 'Cancel'});
				const cancellationToken = { cancelled: false };
				cancelButton.onclick = () => {
					cancellationToken.cancelled = true;
					modal.close();
				};
				modal.open();

				try {
					const result = await this.notionWrapper.publishTable(linkItems, (item) => {
						progressBar.value += 1;
					}, cancellationToken);

					modal.contentEl.empty();
					modal.contentEl.createEl('h2', {text: 'Table Published to Notion'});
					modal.contentEl.createEl('p', {text: `Database URL: ${result.databaseUrl}`});
					modal.contentEl.createEl('p', {text: `Entries Added: ${result.entriesAdded}`});
					modal.contentEl.createEl('p', {text: `Created: ${result.createdTime}`});
					modal.contentEl.createEl('p', {text: `Last Edited: ${result.lastEditedTime}`});
					new Notice(`Published table to Notion`);
				} catch (error) {
					if (error.message !== 'Operation cancelled') {
						console.error('Error:', error);
						new Notice('Failed to publish table to Notion');
					}
				}
			}
		});
	}

	async loadSettings() {
		this.settings = Object.assign({}, {
			notionApiKey: '',
			notionPageId: ''
		}, await this.loadData());
	}

	async saveSettings() {
		const oldSettings = { ...this.settings };
		await this.saveData(this.settings);
		this.notionWrapper = new NotionWrapper(this.settings.notionApiKey, this.settings.notionPageId);
		if (oldSettings.notionApiKey !== this.settings.notionApiKey || oldSettings.notionPageId !== this.settings.notionPageId) {
			try {
				await this.notionWrapper.checkApiKeyValidity();
			} catch (error) {
				console.error('Invalid Notion API key:', error);
			}
		}
	}

	getDescription(content: string): string {
		const lines = content.split('\n');
		const linkLineIdx = lines.findIndex(line => line.startsWith("## Link: "));
		if (linkLineIdx === -1) return "";
		return lines.slice(linkLineIdx + 1).join('\n');
	}

	createTable(headers: string[], data: string[][]): HTMLTableElement {
		const table = document.createElement('table');
		const headerRow = table.createTHead().insertRow();
		headers.forEach(header => {
			const th = document.createElement('th');
			th.textContent = header;
			headerRow.appendChild(th);
		});
		const tbody = table.createTBody();
		data.forEach(row => {
			const tr = tbody.insertRow();
			row.forEach(cell => {
				const td = tr.insertCell();
				td.textContent = cell;
			});
		});
		return table;
	}
}

class PublishTableSettingTab extends PluginSettingTab {
	plugin: PublishTablePlugin;

	constructor(app: App, plugin: PublishTablePlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const {containerEl} = this;

		containerEl.empty();

		new Setting(containerEl)
			.setName('Notion API Key')
			.setDesc('Your Notion API Key')
			.addText(text => text
				.setPlaceholder('Enter your API key')
				.setValue(this.plugin.settings.notionApiKey)
				.onChange(async (value) => {
					this.plugin.settings.notionApiKey = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Notion Page ID')
			.setDesc('The ID of the Notion page to publish to')
			.addText(text => text
				.setPlaceholder('Enter the page ID')
				.setValue(this.plugin.settings.notionPageId)
				.onChange(async (value) => {
					this.plugin.settings.notionPageId = value;
					await this.plugin.saveSettings();
				}));
	}
}