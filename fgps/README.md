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

This project was created using `bun init` in bun v1.1.42. [Bun](https://bun.sh) is a fast all-in-one JavaScript runtime.
