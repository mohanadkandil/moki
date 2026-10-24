# AI runtime decision

Date: 24 October 2026.

Use the TypeScript OpenAI Agents SDK as Moki's primary manager/specialist runtime. It supplies the agent loop and agents-as-tools orchestration while the application owns Daytona integration, shared artifact revisions and release gates. Use the official OpenAI SDK for direct Responses calls and optional Decisions classification. Use the Daytona SDK for actual desktop/file/process execution.

Use the Codex SDK later when a specialist specifically benefits from a local Codex thread, repository exploration and coding workflows. It programmatically controls local Codex agents and is not required to obtain mouse/keyboard access to an isolated desktop. The managed Agents API is another runtime option; it is not selected for this initial application-owned Daytona setup.

The SDK and the model are different choices. Default model is configurable (`gpt-6.1-sol` initially). Model calls, desktop execution, BFL and artifact storage are separate resources. Decisions (`gpt-6-luna`) is optional for fixed-set routing/status questions; it does not generate CAD, tool arguments or engineering proof.

Documentation checked:

- https://developers.openai.com/api/docs/guides/agents/sdk
- https://developers.openai.com/api/docs/guides/agents/orchestration
- https://learn.chatgpt.com/docs/codex-sdk
- https://developers.openai.com/api/docs/guides/tools-computer-use-sdk-drivers
- https://www.daytona.io/docs/en/computer-use/

Installed package types and the lockfile pin the integration surface. No live AI calls are part of the initial environment setup.

