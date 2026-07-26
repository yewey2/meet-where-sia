# Contributing to Meet Where Sia

Thanks for taking the time to improve the project. Focused bug reports, documentation fixes, and small pull requests are welcome.

## Before opening an issue

- Search existing issues and pull requests for the same problem.
- For a bug, include the browser, device, input locations, calculation mode, and the result you expected.
- Remove personal addresses, shared-plan links, passwords, API keys, and other sensitive information from screenshots and logs.
- Report security vulnerabilities privately using [SECURITY.md](SECURITY.md).

## Development setup

```bash
git clone https://github.com/yewey2/meet-where-sia.git
cd meet-where-sia
npm install
cp .env.example .env
npm run dev
```

All integrations are optional for basic development. Exact MRT/LRT station names and Singapore coordinates work without API keys.

## Pull requests

1. Keep the change focused and explain the user-facing reason for it.
2. Add or update tests for behaviour changes.
3. Preserve privacy boundaries: browser variables use `VITE_`; server secrets never do.
4. Retain required map and data attribution.
5. Run the checks before submitting:

   ```bash
   npm run check
   npm test
   npm run build
   ```

6. Include screenshots for visible interface changes and note any new environment variable or deployment step.

Maintainers may close proposals that add operational cost, collect unnecessary personal data, depend on undocumented services, or turn planning estimates into claims of official accuracy.

## Data and calculation changes

Rail topology, station fallbacks, timing assumptions, and geographic calculations can change recommendations for many users. In a pull request that touches them, describe the source, effective date, assumptions, and at least one reproducible before/after example.
