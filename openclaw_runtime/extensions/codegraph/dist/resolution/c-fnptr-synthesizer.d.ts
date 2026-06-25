/**
 * C/C++ function-pointer dispatch synthesis (#932).
 *
 * C/C++ polymorphism is the function pointer: a struct carries a fn-pointer
 * field (`int (*fn)(int)`, or a fn-pointer-typedef field `hook_func func`),
 * concrete functions are *registered* into it through a table
 * (`static struct cmd cmds[] = {{"add", cmd_add}, …}`, a designated
 * `.fn = cmd_add`, or `x->fn = cmd_add`), and the dispatcher calls through it
 * indirectly (`p->fn(argv)`). Static extraction captures neither the
 * registration→field binding nor the indirect call, so the dispatcher→handler
 * edge is missing and `git`'s `run_builtin` looks like it calls nothing, the
 * hooks in `hook_demo.c` are unreachable, etc.
 *
 * This bridges it, keyed by **(struct type, fn-pointer field)**:
 *   • registrations — a function bound to `S.field` via a positional
 *     initializer (matched by field index), a designated `.field = fn`, or a
 *     direct `x.field = fn` / `x->field = fn` assignment;
 *   • dispatch — `recv->field(…)` / `recv.field(…)` where `recv` resolves to a
 *     value of struct type `S` (from the enclosing function's params / locals),
 *     falling back to the field name when it is unique to one struct;
 *   • field←field propagation — `a->f = b->g` merges `B.g`'s handlers into
 *     `A.f`, so a generic single-slot hook that is reassigned from a registry
 *     (the `hook_demo.c` shape: `h->func = found->fn`) still resolves.
 *
 * Whole-graph pass after base resolution; all edges are `provenance:'heuristic'`
 * (`synthesizedBy:'fn-pointer-dispatch'`). High precision via the (type, field)
 * key + a real-function gate; a project with no fn-pointer dispatch is a no-op.
 */
import type { Edge } from '../types';
import type { QueryBuilder } from '../db/queries';
import type { ResolutionContext } from './types';
export declare function cFnPointerDispatchEdges(queries: QueryBuilder, ctx: ResolutionContext): Edge[];
//# sourceMappingURL=c-fnptr-synthesizer.d.ts.map