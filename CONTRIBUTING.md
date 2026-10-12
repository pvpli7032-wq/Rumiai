# Contributing to Khui AI

Thank you for your interest in contributing to **Khui AI**! We welcome bug fixes, documentation improvements, UI enhancements, and new feature implementations.

---

## 🌿 Git Branching Convention

We follow standard branch prefixing:
- `feat/feature-name`: New features or capabilities
- `fix/bug-name`: Bug fixes and layout corrections
- `perf/improvement`: Performance enhancements
- `docs/update`: Documentation additions
- `refactor/scope`: Code cleanup and structural improvements

---

## 💬 Conventional Commits

All commit messages should adhere to the [Conventional Commits](https://www.conventionalcommits.org/) specification:

```text
feat(chat): add speech synthesis voice pitch selector
fix(auth): handle token version mismatch gracefully
docs(readme): expand deployment instructions
perf(db): add index on conversation updated_at
```

---

## 🛠️ Local Development Workflow

1. **Fork and clone the repository:**
   ```bash
   git clone https://github.com/<your-username>/khuiai-fullstack.git
   cd khuiai-fullstack
   ```

2. **Install dependencies and setup database:**
   ```bash
   npm ci
   cp .env.example .env
   npx prisma migrate deploy
   npm run db:seed
   ```

3. **Run local development server:**
   ```bash
   npm run dev
   ```

4. **Run relevant checks against an explicitly isolated server and database (see README.md and DEPLOYMENT.md). HTTP/SSE suites write data; disable real AI and payment credentials:**
   ```bash
   npm test
   node scripts/verify-ai-context.mjs
   node scripts/verify-rate-limit.mjs
   npx tsc --noEmit
   ```

---

## 📋 Pull Request Quality Checklist

Before submitting your PR, verify:
- [ ] TypeScript compiles cleanly (`npx tsc --noEmit`).
- [ ] All automated tests pass (`npm test`).
- [ ] Database migrations are compatible and backward-safe.
- [ ] UI components support dark/light theme switching and responsive mobile viewports.
- [ ] No API keys, passwords, or test tokens are committed.
