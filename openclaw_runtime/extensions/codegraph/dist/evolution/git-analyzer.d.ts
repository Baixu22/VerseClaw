/**
 * Git History Analysis Foundation
 *
 * Analyzes git history to enrich code understanding:
 * - File modification frequency and recency
 * - Author expertise mapping
 * - Hotspot detection (frequently modified files)
 * - Co-change analysis (files that change together)
 */
export interface GitCommitInfo {
    hash: string;
    shortHash: string;
    author: string;
    email: string;
    date: number;
    message: string;
    files: string[];
    additions: number;
    deletions: number;
}
export interface GitFileStats {
    path: string;
    commitCount: number;
    lastModifiedAt: number;
    authors: Map<string, number>;
    coChangedFiles: Map<string, number>;
    changeFrequency: number;
    hotnessScore: number;
}
export interface GitRepoStats {
    totalCommits: number;
    totalFiles: number;
    mostActiveFiles: GitFileStats[];
    hottestFiles: GitFileStats[];
    authorStats: Array<{
        author: string;
        commits: number;
        filesModified: number;
    }>;
}
export interface GitHistoryOptions {
    maxCommits?: number;
    sinceDays?: number;
    fileFilter?: string;
}
export declare class GitHistoryAnalyzer {
    private projectRoot;
    constructor(projectRoot: string);
    isGitRepo(): boolean;
    getRecentCommits(options?: GitHistoryOptions): GitCommitInfo[];
    getFileStats(files?: string[]): Map<string, GitFileStats>;
    getRepoStats(options?: GitHistoryOptions): GitRepoStats;
    getCoChangedFiles(filePath: string, limit?: number): string[];
    getModificationFrequency(filePath: string): number;
    private parseGitLog;
}
//# sourceMappingURL=git-analyzer.d.ts.map