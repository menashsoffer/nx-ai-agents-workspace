# Review gates and dispositions

## Review gates and dispositions

CI, the review threads and the Copilot review (when
[`REQUIRE_COPILOT`](#copilot-review-is-optional) is on) are **required gates on the
PR's head commit**. Every review thread is either resolved or explicitly
dispositioned by the repo owner, and one commit status, **`pipeline/gates`**,
sums it all up for that exact SHA. The main ruleset requires it, pinned to the pipeline App
(`tools/scripts/pipeline/setup-ruleset.sh`). This is a two-week trial.

### The gates

`pipeline/gates` is set by the pipeline App (`approval.yml`, `approval`
command; pure logic in `evaluateGates`). For the current head all of these
must hold, checked in this order:

1. **CI**: the `ci` check run succeeded (and the `security` CI job, if it ran).
2. **Review threads**: no unresolved thread.
3. **Copilot**: it reviewed this head. Only when `REQUIRE_COPILOT` is `true`;
   otherwise this gate is `success` with the detail "not required
   (REQUIRE_COPILOT off)".
4. **`pipeline/protected-approval`**: a pipeline PR that touches protected
   paths needs the owner's approval of this exact head (status `success`,
   recomputed by the `approval` command, not just read back). A PR with no
   protected paths, and any PR the pipeline did not open, gets `success`
   automatically. See [Protected-change approval](pipeline-protected-changes.md#protected-change-approval).

The status is `success` when all hold, `failure` for a real blocker (CI failed,
a required approval was refused) and `pending` otherwise,
its description naming the first missing gate. A push gives the new SHA no
status, which blocks the merge; `approval.yml` posts a `pending` one as soon
as CI is requested so the PR says why it waits. When the gates hold, the
existing hand-off happens: `stage:human-approval`, PR marked ready (only a PR the
pipeline opened as a draft; a person's own draft stays a draft), code
owners requested. Merging stays with a human.

### Copilot review is optional

The Copilot review needs a Copilot licence, so it is **off by default**. The
repo variable `REQUIRE_COPILOT` turns it on, and only the exact string `true`
does: unset, empty, `false`, `TRUE`, `1` or anything else is off (a typo can
never leave `pipeline/gates` pending forever for a review nobody licensed).

- **Off:** the `copilot` gate is `success` ("not required (REQUIRE_COPILOT
  off)"), no review is requested (so `copilot_request_failed` cannot happen)
  and the PR goes to `stage:human-approval` as soon as the other gates hold.
  The state table shows "not required". If Copilot reviews anyway, its threads
  still count as review threads.
- **On:** the review is requested once per head commit after CI and threads
  hold, and the hand-off waits until Copilot reviewed that commit.
- **To turn it on:** set the variable `REQUIRE_COPILOT` to `true`, and either
  give the secret `COPILOT_REVIEW_TOKEN` the token of a Copilot-licensed user
  or enable automatic Copilot review for the repo, and enable Copilot code
  review (Settings → Copilot → Code review).

**Why one status:** the ruleset can only require named checks. Requiring
CI, Copilot and thread resolution separately would need a status for each and
would not express "resolved _or_ dispositioned". One bot-set status bound to
the SHA, computed by tested code, is the single thing to require. Only the App can set it (the ruleset pins its integration id). GitHub has
no workflow trigger for resolving a thread by hand: resolve through
`/disposition`, or re-run **Pipeline · Approval** (Actions → run workflow, PR
number) after resolving one manually.

The bot keeps one **Review gates** comment per PR (`<!-- pipeline:gates -->`,
edited in place): each gate, the open Copilot threads with their ids, and the
dispositions on record.

### Thread ids

Copilot threads: `C-<n>`, `n` = database id of the thread's top comment,
listed in the Review gates comment.

### `/disposition` (owner only)

Three ways to post it, all the owner's **new** comments (never an edit):

1. **A top-level PR comment** whose body is one or more lines of exactly

   ```
   /disposition <finding-id> <accepted-risk|false-positive|out-of-scope> <reason, at least 10 characters>
   ```

2. **A quote reply.** GitHub's "Quote reply" puts the quoted text (`> ...`
   lines) first. A quote block at the top of the body, and blank lines, are
   ignored; the command follows it. A quote in the middle or at the end is
   not.
3. **A reply inside the finding's own review thread** (a Copilot thread).
   The short form leaves the id
   out, because the thread names it: `/disposition <kind> <reason>`. The long
   form works too, but its id must be the thread's. One command per reply. In a
   thread that is not a finding thread the command is refused. The bot answers
   in the thread (`Recorded: see <link>` or the `Not recorded: ...` reason) and
   writes the record note in the PR conversation, where `approval.yml` reads it.

The only comment that does not count is an edit of an existing one.

- Every line must be valid, or the comment is rejected as a whole with one
  short bot reply giving the reason. Prose around the command is a rejection.
  A comment where `/disposition` starts a line but something other than a
  quote block comes before it is answered with "the command must be the first
  thing in the comment ... Post it again as a new comment", never silence. A
  mention in backticks or in the middle of a sentence is ordinary discussion
  and is ignored.
- Accepted only from `vars.PIPELINE_OWNER_LOGIN` and only from a `User`
  account. Not `author_association`, not the PR author. Unset variable: nobody.
  Others' comments are ignored without a reply. Same-repo branches only.
- The id must be an open Copilot thread on the PR.
- On acceptance the bot resolves the finding's review thread (so the
  ruleset's thread-resolution requirement is met), then appends one record
  note per finding: `<!-- pipeline:disposition id=… kind=… head=<sha> by=<login> comment=<id> -->`
  with the reason in a fenced block. The notes re-run `approval.yml`.

### What a disposition records

A record names the head the owner saw and the thread id (`C-<n>`). Accepting
it resolves that thread, so the gates stop counting it; the record stays on
the PR and the Review gates comment lists it with the owner's reason. Only
records made by the owner count, and only the bot's own notes are read.
