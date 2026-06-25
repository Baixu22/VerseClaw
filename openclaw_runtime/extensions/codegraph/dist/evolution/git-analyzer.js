"use strict";
/**
 * Git History Analysis Foundation
 *
 * Analyzes git history to enrich code understanding:
 * - File modification frequency and recency
 * - Author expertise mapping
 * - Hotspot detection (frequently modified files)
 * - Co-change analysis (files that change together)
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.GitHistoryAnalyzer = void 0;
const child_process_1 = require("child_process");
const MAX_DEFAULT_COMMITS = 500;
class GitHistoryAnalyzer {
    projectRoot;
    constructor(projectRoot) {
        this.projectRoot = projectRoot;
    }
    isGitRepo() {
        try {
            (0, child_process_1.execFileSync)('git', ['rev-parse', '--git-dir'], {
                cwd: this.projectRoot,
                stdio: 'pipe',
            });
            return true;
        }
        catch {
            return false;
        }
    }
    getRecentCommits(options = {}) {
        const maxCommits = options.maxCommits ?? MAX_DEFAULT_COMMITS;
        const sinceDays = options.sinceDays;
        const args = ['log', '--format=%H|%h|%an|%ae|%at|%s', `-n${maxCommits}`];
        if (sinceDays) {
            args.push(`--since=${sinceDays}.days.ago`);
        }
        args.push('--numstat', '--');
        if (options.fileFilter) {
            args.push(options.fileFilter);
        }
        try {
            const output = (0, child_process_1.execFileSync)('git', args, {
                cwd: this.projectRoot,
                stdio: 'pipe',
                maxBuffer: 50 * 1024 * 1024,
            });
            return this.parseGitLog(output.toString());
        }
        catch {
            return [];
        }
    }
    getFileStats(files) {
        const statsMap = new Map();
        const commits = this.getRecentCommits();
        for (const commit of commits) {
            for (const file of commit.files) {
                if (files && !files.includes(file))
                    continue;
                let stats = statsMap.get(file);
                if (!stats) {
                    stats = {
                        path: file,
                        commitCount: 0,
                        lastModifiedAt: 0,
                        authors: new Map(),
                        coChangedFiles: new Map(),
                        changeFrequency: 0,
                        hotnessScore: 0,
                    };
                    statsMap.set(file, stats);
                }
                stats.commitCount++;
                stats.lastModifiedAt = Math.max(stats.lastModifiedAt, commit.date);
                stats.authors.set(commit.author, (stats.authors.get(commit.author) ?? 0) + 1);
                // Track co-changed files
                for (const coFile of commit.files) {
                    if (coFile !== file) {
                        stats.coChangedFiles.set(coFile, (stats.coChangedFiles.get(coFile) ?? 0) + 1);
                    }
                }
            }
        }
        // Calculate hotness scores
        const now = Date.now();
        for (const [_filePath, stats] of statsMap) {
            const recencyDays = stats.lastModifiedAt > 0 ? (now - stats.lastModifiedAt * 1000) / (1000 * 60 * 60 * 24) : 365;
            const recencyScore = Math.max(0, 1 - recencyDays / 90);
            const frequencyScore = Math.min(1, stats.commitCount / 50);
            const authorDiversity = stats.authors.size;
            stats.hotnessScore = Math.round((recencyScore * 0.3 + frequencyScore * 0.4 + Math.min(1, authorDiversity / 5) * 0.3) * 100) / 100;
        }
        return statsMap;
    }
    getRepoStats(options = {}) {
        const statsMap = this.getFileStats();
        const allStats = Array.from(statsMap.values());
        allStats.sort((a, b) => b.commitCount - a.commitCount);
        const authorMap = new Map();
        // Count author contributions
        const commits = this.getRecentCommits(options);
        for (const commit of commits) {
            let authorStat = authorMap.get(commit.author);
            if (!authorStat) {
                authorStat = { commits: 0, filesModified: 0 };
                authorMap.set(commit.author, authorStat);
            }
            authorStat.commits++;
            authorStat.filesModified += commit.files.length;
        }
        const authorStats = Array.from(authorMap.entries())
            .map(([author, stats]) => ({ author, ...stats }))
            .sort((a, b) => b.commits - a.commits);
        return {
            totalCommits: commits.length,
            totalFiles: statsMap.size,
            mostActiveFiles: allStats.slice(0, 20),
            hottestFiles: [...allStats].sort((a, b) => b.hotnessScore - a.hotnessScore).slice(0, 20),
            authorStats: authorStats.slice(0, 10),
        };
    }
    getCoChangedFiles(filePath, limit = 20) {
        const statsMap = this.getFileStats();
        const fileStats = statsMap.get(filePath);
        if (!fileStats)
            return [];
        return Array.from(fileStats.coChangedFiles.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, limit)
            .map(([path]) => path);
    }
    getModificationFrequency(filePath) {
        const statsMap = this.getFileStats();
        return statsMap.get(filePath)?.commitCount ?? 0;
    }
    parseGitLog(output) {
        const commits = [];
        let currentCommit = null;
        for (const line of output.split('\n')) {
            const trimmed = line.trim();
            if (trimmed === '')
                continue;
            // Commit line: hash|shortHash|author|email|timestamp|message
            if (trimmed.includes('|')) {
                const parts = trimmed.split('|');
                if (parts.length >= 6) {
                    if (currentCommit)
                        commits.push(currentCommit);
                    currentCommit = {
                        hash: parts[0] ?? '',
                        shortHash: parts[1] ?? '',
                        author: parts[2] ?? '',
                        email: parts[3] ?? '',
                        date: parseInt(parts[4] ?? '0', 10),
                        message: parts.slice(5).join('|'),
                        files: [],
                        additions: 0,
                        deletions: 0,
                    };
                }
                continue;
            }
            // File stats line: additions\tdeletions\tfilename
            if (currentCommit && /^\d+\s+\d+\s+/.test(trimmed)) {
                const [addStr, delStr, ...fileParts] = trimmed.split(/\s+/);
                const filename = fileParts.join(' ');
                if (addStr !== undefined && delStr !== undefined && filename) {
                    currentCommit.additions += parseInt(addStr, 10) || 0;
                    currentCommit.deletions += parseInt(delStr, 10) || 0;
                    currentCommit.files.push(filename);
                }
            }
        }
        if (currentCommit)
            commits.push(currentCommit);
        return commits;
    }
}
exports.GitHistoryAnalyzer = GitHistoryAnalyzer;
//# sourceMappingURL=git-analyzer.js.map