# Local AWS claim evidence

`claim_evidence.py` reviews one short English technical claim against the existing AWS documentation snapshot. It uses the stored BGE vectors, exact cosine search, and the existing [Codex subscription Workbench](../content-workbench/README.md). The vector search runs locally without a database process.

## Run it

On macOS, use the existing retrieval Python environment (Python 3.12, NumPy, and FastEmbed), pinned `retrieval-v3` corpus, and local BGE cache from the [evidence tools setup](../mcp-server/README.md#opt-in-local-public-evidence-tools-190). Build the Workbench with its .NET 10 SDK and use its supported Codex CLI and ChatGPT login. If `dotnet` is outside your PATH, pass its path with `--dotnet`.

From the repository root:

```sh
dotnet build tools/content-workbench/Workbench
python tools/content-pipeline/claim_evidence.py \
  --corpus /absolute/path/to/retrieval-v3 \
  --model-cache /absolute/path/to/local-model-cache \
  --query 'How often are AWS managed AWS KMS keys rotated and can their use be audited with AWS CloudTrail?' \
  'AWS managed KMS keys are automatically rotated every year, and customers can audit their use in AWS CloudTrail logs.'
```

Omit `--query` to use the claim as the initial search. The script can return `supported`, `contradicted`, or `insufficient`. The result shows citations with original text, AWS URLs, source versions and offsets. It also reports the first verdict, focused queries, and the number of completed reviews.

## How it works

1. Search the frozen AWS snapshot and send up to eight original chunks to the reviewer.
2. If the reviewer identifies missing evidence, use its focused questions to retrieve new candidates. Preserve cited first-pass material and keep the same eight-chunk and 12,000-character limits.
3. Review the revised packet once if it contains different evidence. The program resolves every returned citation ID against the packet, then emits exact source text. If the evidence is still inadequate, the result stays `insufficient`. Input or execution failures exit with an error.

A citation identifies the excerpt; the review is the model's judgment about what it supports. Treat the output as a local diagnostic. It carries no card approval or publication authority. Search uses the pinned corpus snapshot; use the AWS guide to verify missing or newer material.

## Regression checks

```sh
python -m unittest discover -s tools/content-pipeline -p test_claim_evidence.py -v
```

The deterministic checks cover targeted retry, unresolved evidence, quote source identity, query validation, contradiction, and context limits. The broader historical [RAG evaluation](STATUS.md) has its own release gate.
