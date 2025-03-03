# FGPS Project Guidelines

## Build Commands

- **Run project**: `bun run start` or `bun run --hot index.ts`
- **Install dependencies**: `bun install`
- **Clean and reinstall**: `bun run nuke`
- **Type checking**: `bun --bun tsc --noEmit`

## Code Style Guidelines

- **Imports**: Group imports by type (Node.js built-ins first, then external libraries, then internal modules)
- **Types**: Use TypeScript interfaces for data structures, prefer strict typing
- **Naming**: Use camelCase for variables/functions, PascalCase for interfaces/types
- **Error handling**: Use try/catch blocks with specific error messages; avoid letting errors propagate silently
- **Constants**: Define configuration constants at the file top with UPPER_SNAKE_CASE
- **Comments**: Add comments for complex logic or non-obvious behavior
- **Formatting**: Use 2-space indentation, single quotes for strings

## Project Structure

- Single module TypeScript project using Bun runtime
- GeoJSON input used for position simulation
- NMEA and BESTPOS message formats for GPS data simulation
