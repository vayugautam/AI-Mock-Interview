import fs from 'fs';
import path from 'path';
import type {
  JobDescriptionAnalysis,
  ResumeAnalysis,
  WebResearchSource,
} from '../src/types';

export interface StoredDocumentRecord {
  id: string;
  schemaVersion: number;
  userId: string;
  docType: 'jd' | 'resume';
  sourceType: 'pdf' | 'text';
  fileName?: string;
  fileSizeBytes?: number;
  pageCount?: number;
  charCount: number;
  rawText: string;
  normalizedText: string;
  analysis: JobDescriptionAnalysis | ResumeAnalysis;
  analysisPromptVersion?: string;
  webResearchSummary?: string;
  webSources?: WebResearchSource[];
  webResearchStatus?: 'completed' | 'skipped' | 'unavailable';
  chunkIds: string[];
  createdAt: string;
}

const CURRENT_SCHEMA_VERSION = 2;

export class DocumentStore {
  private filePath: string;
  private documents: StoredDocumentRecord[] = [];

  constructor(dataDir: string) {
    this.filePath = path.join(dataDir, 'documents_d3.json');
    this.loadAndMigrate();
  }

  private loadAndMigrate() {
    try {
      if (fs.existsSync(this.filePath)) {
        const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));
        if (Array.isArray(parsed)) {
          let dirty = false;
          this.documents = parsed.map((doc) => {
            if (!doc.schemaVersion || doc.schemaVersion < CURRENT_SCHEMA_VERSION) {
              dirty = true;
              return {
                ...doc,
                schemaVersion: CURRENT_SCHEMA_VERSION,
                chunkIds: Array.isArray(doc.chunkIds) ? doc.chunkIds : [],
              };
            }
            return doc;
          });
          if (dirty) this.save();
          return;
        }
      }
    } catch (err) {
      console.error('Failed loading documents_d3 store:', err);
    }
    this.documents = [];
  }

  private save() {
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(this.documents, null, 2), 'utf-8');
    } catch (err) {
      console.error('Failed saving documents_d3 store:', err);
      throw new Error('Database persistence error while saving document record');
    }
  }

  public addDocument(
    doc: Omit<StoredDocumentRecord, 'schemaVersion' | 'createdAt'> & { createdAt?: string }
  ): StoredDocumentRecord {
    const record: StoredDocumentRecord = {
      ...doc,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      createdAt: doc.createdAt || new Date().toISOString(),
    };
    this.documents.unshift(record);
    this.save();
    return record;
  }

  public getDocumentByIdForUser(docId: string, userId: string): StoredDocumentRecord | null {
    const doc = this.documents.find((d) => d.id === docId);
    if (!doc) return null;
    if (doc.userId !== userId) return null; // Strict user ownership enforcement
    return doc;
  }

  public getDocumentRawById(docId: string): StoredDocumentRecord | null {
    return this.documents.find((d) => d.id === docId) || null;
  }

  public getLatestForUser(
    userId: string,
    docType: 'jd' | 'resume'
  ): StoredDocumentRecord | null {
    return (
      this.documents.find((d) => d.userId === userId && d.docType === docType) || null
    );
  }

  public listForUser(userId: string): StoredDocumentRecord[] {
    return this.documents.filter((d) => d.userId === userId);
  }
}

export function toPublicDocumentSummary(doc: StoredDocumentRecord) {
  return {
    id: doc.id,
    userId: doc.userId,
    docType: doc.docType,
    sourceType: doc.sourceType,
    fileName: doc.fileName,
    fileSizeBytes: doc.fileSizeBytes,
    pageCount: doc.pageCount,
    charCount: doc.charCount,
    normalizedText: doc.normalizedText,
    previewText:
      doc.normalizedText.length > 750
        ? doc.normalizedText.slice(0, 750) + '...'
        : doc.normalizedText,
    analysis: doc.analysis,
    analysisPromptVersion: doc.analysisPromptVersion,
    webResearchSummary: doc.webResearchSummary,
    webSources: doc.webSources || [],
    webResearchStatus: doc.webResearchStatus || 'skipped',
    chunkCount: doc.chunkIds.length,
    createdAt: doc.createdAt,
  };
}
