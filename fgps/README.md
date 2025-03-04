# fgps

A GPS data simulator that generates NMEA GGA and BESTPOS messages from GeoJSON tracks.

## Installation

To install dependencies:

```bash
bun install
```

## Running

To run the simulator:

```bash
bun run start
```

This will start a TCP server that serves GPS data and an interactive terminal for control.

## Interactive Commands

- `p` - Play (start sending GPS data)
- `s` - Stop (pause sending GPS data)
- `q` - Quit the application

## TCP Client Commands

When connected to the TCP server, clients can send:

- `play` - Resume GPS data stream
- `pause` - Pause GPS data stream

## Testing

The project includes unit tests for all key components. To run tests:

```bash
bun test
```

## Development Scripts

- `bun run start` - Start the application with hot reloading
- `bun test` - Run the test suite
- `bun --bun tsc --noEmit` - Run TypeScript type checking
- `bun run nuke` - Clean and reinstall dependencies

This project uses [Bun](https://bun.sh), a fast all-in-one JavaScript runtime.
