# Robotfoci

A modern Angular-based multiplayer robot soccer game utilizing WebSockets for real-time gameplay.

Note that this is only an example for the implementation of the server!

## Prerequisites

Before you begin, ensure you have [Node.js](https://nodejs.org/) and [npm](https://www.npmjs.com/) installed on your machine.

## Installation

Install the project dependencies by running:

```bash
npm install
```

## Configuration

> [!IMPORTANT]
> **IP Address Configuration Required**
>
> You **HAVE** to replace the hardcoded IP address (`192.168.88.1`) in `package.json` with your own computer's local network IP address in the `start` script.
>
> Additionally, ensure the `serverUrl` in `src/environments/environment.ts` and `src/environments/environment.prod.ts` is updated to point to your backend server's IP address.

## Running the Application

To start the client development server, use the following command:

```bash
npm start
```

This will start the Angular application and make it reachable on your local network at the configured IP and port `4500`.