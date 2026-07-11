export type TaskLedgerReference = {
    direction: 'workboard-to-task-ledger';
    taskLedgerNodeId: string;
    workboardCardId?: string;
    source: 'workboard' | 'plugin' | 'runtime';
};
export declare function createTaskLedgerReference(input: {
    taskLedgerNodeId: string;
    workboardCardId?: string | null;
    source?: TaskLedgerReference['source'];
}): TaskLedgerReference;
export declare function isTaskLedgerReference(value: unknown): value is TaskLedgerReference;
