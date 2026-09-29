import { readFileSync, existsSync } from "node:fs";
import { basename, extname } from "node:path";
import { loadEnv } from "@bix/config";
import { SqliteDatabase, LocalFileStorage } from "@bix/storage";
import {
  FalSeedanceProvider,
  VideoJobStore,
  VideoRunner,
  type VideoRequest,
} from "@bix/video";

interface VideoArgs {
  promptFile?: string;
  refs: string[];
  resolution: string;
  aspectRatio: string;
  duration: string;
  generateAudio: boolean;
}

function parseArgs(argv: string[]): VideoArgs {
  const args: VideoArgs = {
    refs: [],
    resolution: "720p",
    aspectRatio: "9:16",
    duration: "5",
    generateAudio: true,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = (): string => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`Missing value for ${arg}`);
      return v;
    };
    switch (arg) {
      case "--prompt-file":
        args.promptFile = next();
        break;
      case "--ref":
        args.refs.push(next());
        break;
      case "--resolution":
        args.resolution = next();
        break;
      case "--aspect-ratio":
        args.aspectRatio = next();
        break;
      case "--duration":
        args.duration = next();
        break;
      case "--generate-audio":
        args.generateAudio = next().toLowerCase() !== "false";
        break;
      case "--no-audio":
        args.generateAudio = false;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

function printVideoUsage(): void {
  console.log("Usage: npm run video -- --prompt-file <path> --ref <image> [--ref <image> ...]");
  console.log("");
  console.log("Options:");
  console.log("  --prompt-file <path>   File containing the text prompt (required)");
  console.log("  --ref <path>           Reference image; repeat for multiple (required)");
  console.log("  --resolution <val>     480p | 720p | 1080p           (default 720p)");
  console.log("  --aspect-ratio <val>   9:16 | 16:9 | 1:1 | auto ...  (default 9:16)");
  console.log("  --duration <val>       seconds 4-30, or auto          (default 5)");
  console.log("  --generate-audio <b>   true | false                   (default true)");
  console.log("  --no-audio             shorthand for --generate-audio false");
}

export async function runVideo(argv: string[]): Promise<number> {
  let args: VideoArgs;
  try {
    args = parseArgs(argv);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    console.error("");
    printVideoUsage();
    return 1;
  }

  if (!args.promptFile) {
    console.error("Missing required --prompt-file.\n");
    printVideoUsage();
    return 1;
  }
  if (args.refs.length === 0) {
    console.error("Provide at least one --ref reference image.\n");
    printVideoUsage();
    return 1;
  }

  if (!existsSync(args.promptFile)) {
    console.error(`Prompt file not found: ${args.promptFile}`);
    return 1;
  }
  for (const ref of args.refs) {
    if (!existsSync(ref)) {
      console.error(`Reference image not found: ${ref}`);
      return 1;
    }
  }

  const prompt = readFileSync(args.promptFile, "utf8").trim();
  if (prompt.length === 0) {
    console.error(`Prompt file is empty: ${args.promptFile}`);
    return 1;
  }

  // Duration is either "auto" or a number of seconds.
  const duration: number | string =
    args.duration === "auto" ? "auto" : Number(args.duration);
  if (duration !== "auto" && Number.isNaN(duration)) {
    console.error(`Invalid --duration: ${args.duration} (use a number 4-30 or "auto").`);
    return 1;
  }

  loadEnv();

  const provider = new FalSeedanceProvider();
  const db = new SqliteDatabase("data/bix.db");
  const store = new VideoJobStore(db);
  const fileStorage = new LocalFileStorage(process.cwd());
  const runner = new VideoRunner({ provider, store, fileStorage });

  const request: VideoRequest = {
    prompt,
    refImagePaths: args.refs,
    resolution: args.resolution,
    aspectRatio: args.aspectRatio,
    duration,
    generateAudio: args.generateAudio,
    label: basename(args.promptFile, extname(args.promptFile)),
  };

  try {
    const result = await runner.generate(request);
    const localPath = fileStorage.localPath(result.outputPath);
    console.log("");
    console.log(result.resumed ? "Resumed an existing job." : "Completed a new job.");
    console.log(`Job id:     ${result.jobId.slice(0, 12)}`);
    console.log(`Request id: ${result.requestId}`);
    console.log(`Video:      ${localPath}`);
    return 0;
  } catch (err) {
    console.error("");
    console.error(`Video generation failed: ${err instanceof Error ? err.message : String(err)}`);
    console.error("Rerun the same command to resume the saved request.");
    return 1;
  } finally {
    db.close();
  }
}
