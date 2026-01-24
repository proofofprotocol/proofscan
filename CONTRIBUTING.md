# Contributing to proofscan

Thank you for your interest in contributing to proofscan! This guide will help you get started.

## Getting Started

### Prerequisites

- Node.js v18+ (v20+ recommended)
- npm v8+
- Git

### Development Setup

```bash
# Clone the repository
git clone https://github.com/proofofprotocol/proofscan.git
cd proofscan

# Install dependencies
npm install

# Build
npm run build

# Run tests
npm test

# Run from source
node dist/cli.js --help
```

### Development Workflow

```bash
# Watch mode (rebuild on changes)
npm run dev

# In another terminal, run commands
node dist/cli.js status

# Run linter
npm run lint

# Run tests with coverage
npm run test:cov
```

## Project Structure

```
proofscan/
├── src/                 # TypeScript source
│   ├── cli.ts          # Main CLI entry
│   ├── commands/       # Command implementations
│   ├── db/             # Database layer
│   └── ...             # Other modules
├── dist/               # Compiled JavaScript
├── docs/               # Documentation
├── coverage/           # Test coverage reports
└── package.json
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for detailed architecture documentation.

## Making Changes

### Branch Naming

Use descriptive branch names:

- `feature/add-new-command`
- `fix/session-list-crash`
- `docs/update-readme`
- `refactor/simplify-scanner`

### Commit Messages

Follow conventional commits:

```
feat: add catalog search command
fix: handle empty tool list gracefully
docs: update API documentation
refactor: extract transport logic
test: add scanner unit tests
chore: update dependencies
```

### Code Style

- TypeScript with strict mode
- ESLint for linting
- 2-space indentation
- Single quotes for strings
- Semicolons required

Run `npm run lint` before committing.

### Testing

- Write tests for new features
- Tests live alongside source files (`*.test.ts`)
- Use Vitest for testing

```bash
# Run all tests
npm test

# Run specific test file
npm test -- src/commands/catalog.test.ts

# Watch mode
npm run test:watch

# Coverage report
npm run test:cov
```

## Pull Request Process

1. **Fork** the repository
2. **Create** a feature branch
3. **Make** your changes
4. **Test** thoroughly
5. **Commit** with clear messages
6. **Push** to your fork
7. **Open** a Pull Request

### PR Checklist

- [ ] Tests pass (`npm test`)
- [ ] Linting passes (`npm run lint`)
- [ ] Documentation updated if needed
- [ ] CHANGELOG.md updated for user-facing changes
- [ ] Commit messages are clear

### PR Description Template

```markdown
## Summary
Brief description of changes.

## Changes
- Added feature X
- Fixed bug Y
- Updated documentation for Z

## Testing
How was this tested?

## Related Issues
Fixes #123
```

## Adding a New Command

1. Create command file:

```typescript
// src/commands/mycommand.ts
import { Command } from 'commander';

export function createMyCommand(getConfigPath: () => string): Command {
  const cmd = new Command('mycommand')
    .description('Description here')
    .option('-o, --option <value>', 'Option description')
    .action(async (options) => {
      const configPath = getConfigPath();
      // Implementation
    });
  
  return cmd;
}
```

2. Export from index:

```typescript
// src/commands/index.ts
export { createMyCommand } from './mycommand.js';
```

3. Register in CLI:

```typescript
// src/cli.ts
import { createMyCommand } from './commands/index.js';

program.addCommand(createMyCommand(getConfigPath));
```

4. Add tests:

```typescript
// src/commands/mycommand.test.ts
import { describe, it, expect } from 'vitest';

describe('mycommand', () => {
  it('should do something', () => {
    // Test implementation
  });
});
```

5. Update documentation:
   - Add to `docs/GUIDE.md`
   - Update README if significant

## Internationalization (i18n)

proofscan supports multiple languages. See [docs/i18n.md](docs/i18n.md) for details.

When adding user-facing strings:

1. Add to English locale first
2. Use `t('key')` for translation
3. Document the string for translators

## Documentation

- **README.md** - Project overview and quick start
- **docs/GUIDE.md** - Complete CLI reference
- **docs/API.md** - TypeScript API
- **docs/ARCHITECTURE.md** - Internal design
- **CHANGELOG.md** - Version history

Update relevant docs when making changes.

## Release Process

Releases are managed by maintainers. See [docs/release.md](docs/release.md) for details.

Version bumping:

```bash
npm version patch  # Bug fixes
npm version minor  # New features
npm version major  # Breaking changes
```

## Getting Help

- **Issues**: [GitHub Issues](https://github.com/proofofprotocol/proofscan/issues)
- **Discussions**: [GitHub Discussions](https://github.com/proofofprotocol/proofscan/discussions)

## Code of Conduct

Be respectful and constructive. We're all here to build something useful.

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

---

Thank you for contributing! 🎉
