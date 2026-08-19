const expectedNode = "26.7.0";
const expectedPnpm = "11.19.0";

if (process.versions.node !== expectedNode) {
  console.error(
    `Zork Voice requires Node ${expectedNode}; received ${process.versions.node}.`,
  );
  process.exit(1);
}

const userAgent = process.env.npm_config_user_agent ?? "";
if (userAgent && !userAgent.startsWith(`pnpm/${expectedPnpm} `)) {
  console.error(
    `Zork Voice requires pnpm ${expectedPnpm}; received ${userAgent}.`,
  );
  process.exit(1);
}
