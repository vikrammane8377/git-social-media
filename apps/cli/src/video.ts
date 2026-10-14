import { readFileSync, existsSync } from "node:fs";
import { basename, extname } from "node:path";
import { loadEnv } from "@bix/config";
import { SqliteDatabase, LocalFileStorage } from "@bix/storage";
import {
  FalSeedanceProvider,
  FalAvatarSingleTextProvider,
  FalVeo31FastProvider,
  FalKlingV3ProProvider,
  HiggsfieldWanProvider,
  VideoJobStore,
  VideoRunner,
  type VideoRequest,
  type VideoProvider,
} from "@bix/video";
import { publishFile } from "./youtube.js";

type ProviderName = "wan" | "seedance" | "avatar" | "veo" | "kling";

interface VideoArgs {
  provider: ProviderName;
  promptFile?: string;
  refs: string[];
  resolution: string;
  aspectRatio: string;
  duration: string;
  generateAudio: boolean;
  /** Wan only: pass every --ref as a plain reference (no start_image first frame). */
  referencesOnly: boolean;
  // Talking-avatar (provider "avatar") only:
  scriptFile?: string;
  script?: string;
  voice?: string;
  frames?: string;
  // Publish-to-YouTube (Component 5) only:
  publish: boolean;
  slot?: string;
  date?: string;
  privacy: string;
}

function parseArgs(argv: string[]): VideoArgs {
  const args: VideoArgs = {
    provider: "wan",
    refs: [],
    resolution: "720p",
    aspectRatio: "9:16",
    duration: "5",
    generateAudio: true,
    referencesOnly: false,
    publish: false,
    privacy: "public",
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = (): string => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`Missing value for ${arg}`);
      return v;
    };
    switch (arg) {
      case "--provider": {
        const v = next().toLowerCase();
        if (v !== "wan" && v !== "seedance" && v !== "avatar" && v !== "veo" && v !== "kling") {
          throw new Error(
            `Invalid --provider: ${v} (use "wan", "seedance", "avatar", "veo" or "kling").`,
          );
        }
        args.provider = v;
        break;
      }
      case "--prompt-file":
        args.promptFile = next();
        break;
      case "--ref":
        args.refs.push(next());
        break;
      case "--script-file":
        args.scriptFile = next();
        break;
      case "--script":
        args.script = next();
        break;
      case "--voice":
        args.voice = next();
        break;
      case "--frames":
        args.frames = next();
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
      case "--references-only":
        args.referencesOnly = true;
        break;
      case "--publish":
        args.publish = true;
        break;
      case "--slot":
        args.slot = next();
        break;
      case "--date":
        args.date = next();
        break;
      case "--privacy": {
        const v = next().toLowerCase();
        if (v !== "public" && v !== "unlisted" && v !== "private") {
          throw new Error(`Invalid --privacy: ${v} (use public, unlisted or private).`);
        }
        args.privacy = v;
        break;
      }
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

function printVideoUsage(): void {
  console.log("Usage: npm run video -- --prompt-file <path> --ref <image> [options]");
  console.log("");
  console.log("Options:");
  console.log("  --provider <name>      wan | seedance | avatar | veo | kling (default wan)");
  console.log("  --prompt-file <path>   File containing the scene/motion prompt (required)");
  console.log("  --ref <path>           Reference image; repeat for multiple (required)");
  console.log("  --resolution <val>     480p | 720p | 1080p           (default 720p)");
  console.log("");
  console.log("wan (default; talking clip via Higgsfield MCP, spends plan credits not FAL_KEY):");
  console.log("  --aspect-ratio <val>   9:16 | 16:9 | 1:1 | 4:3 | 3:4  (default 9:16)");
  console.log("  --duration <val>       whole seconds 2-30             (default 5)");
  console.log("  --resolution <val>     480p | 720p | 1080p            (default 720p)");
  console.log("  --generate-audio <b>   true | false                   (default true)");
  console.log("  --references-only      Pass every --ref as a plain reference (no start_image)");
  console.log("  (requires: npm run higgsfield -- login)");
  console.log("");
  console.log("seedance (silent/ambient clip):");
  console.log("  --aspect-ratio <val>   9:16 | 16:9 | 1:1 | auto ...  (default 9:16)");
  console.log("  --duration <val>       seconds 4-30, or auto          (default 5)");
  console.log("  --generate-audio <b>   true | false                   (default true)");
  console.log("  --no-audio             shorthand for --generate-audio false");
  console.log("");
  console.log("veo (talking clip; the model speaks the dialogue in your prompt):");
  console.log("  --resolution <val>     720p | 1080p | 4k              (default 720p)");
  console.log("  --aspect-ratio <val>   auto | 16:9 | 9:16             (default 9:16)");
  console.log("  --duration <val>       4 | 6 | 8 seconds              (default 8)");
  console.log("  --generate-audio <b>   true | false                   (default true)");
  console.log("");
  console.log("kling (talking clip; 1080p, aspect from the image, dialogue in prompt):");
  console.log("  --duration <val>       whole seconds 3-15             (default 5)");
  console.log("  --generate-audio <b>   true | false                   (default true)");
  console.log("  (--resolution and --aspect-ratio are ignored by kling)");
  console.log("");
  console.log("avatar (talking mascot; the model generates the voice from text):");
  console.log("  --script <text>        The line the mascot speaks");
  console.log("  --script-file <path>   ...or read the line from a file");
  console.log("  --voice <name>         Built-in voice, e.g. Bill, Brian, Will, Aria (required)");
  console.log("  --frames <n>           41-721 frames, ~25fps          (default 145 ~5.8s)");
  console.log("");
  console.log("publish (upload the result to YouTube after a successful generation):");
  console.log("  --publish              Upload the finished MP4 to YouTube");
  console.log("  --slot <id>            Plan slot supplying the metadata (or use --date)");
  console.log("  --date <YYYY-MM-DD>    Pick the slot by date (default: today)");
  console.log("  --privacy <val>        public | unlisted | private   (default public)");
  console.log("  (requires: npm run youtube -- login; needs --slot or --date)");
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

  // Publishing needs to know which plan slot supplies the metadata; fail early
  // (before generating) so we never produce a clip we then cannot publish.
  if (args.publish && !args.slot && !args.date) {
    console.error("--publish requires --slot <id> or --date <YYYY-MM-DD> to pick the plan slot.\n");
    printVideoUsage();
    return 1;
  }

  // Duration is either "auto" or a number of seconds.
  const duration: number | string =
    args.duration === "auto" ? "auto" : Number(args.duration);
  if (duration !== "auto" && Number.isNaN(duration)) {
    console.error(`Invalid --duration: ${args.duration} (use a number 4-30 or "auto").`);
    return 1;
  }

  // Talking-avatar mode needs a spoken line, a voice, and exactly one image.
  let textInput: string | undefined;
  let voice: string | undefined;
  let numFrames: number | undefined;
  if (args.provider === "avatar") {
    if (args.scriptFile && !existsSync(args.scriptFile)) {
      console.error(`Script file not found: ${args.scriptFile}`);
      return 1;
    }
    textInput = args.script ?? (args.scriptFile ? readFileSync(args.scriptFile, "utf8").trim() : "");
    if (!textInput || textInput.length === 0) {
      console.error("avatar provider needs a line to speak: pass --script or --script-file.\n");
      printVideoUsage();
      return 1;
    }
    if (!args.voice) {
      console.error("avatar provider needs --voice (e.g. Bill, Brian, Will, Aria).\n");
      printVideoUsage();
      return 1;
    }
    voice = args.voice;
    if (args.refs.length !== 1) {
      console.error("avatar provider uses exactly one --ref image.");
      return 1;
    }
    if (args.frames !== undefined) {
      const f = Number(args.frames);
      if (!Number.isInteger(f) || f < 41 || f > 721) {
        console.error(`Invalid --frames: ${args.frames} (use an integer 41-721).`);
        return 1;
      }
      numFrames = f;
    }
  }

  loadEnv();

  const provider: VideoProvider =
    args.provider === "avatar"
      ? new FalAvatarSingleTextProvider()
      : args.provider === "veo"
        ? new FalVeo31FastProvider()
        : args.provider === "kling"
          ? new FalKlingV3ProProvider()
          : args.provider === "seedance"
            ? new FalSeedanceProvider()
            : new HiggsfieldWanProvider();
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
    referencesOnly: args.referencesOnly,
    textInput,
    voice,
    numFrames,
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

    if (args.publish) {
      try {
        console.log("");
        const outcome = await publishFile({
          storageKey: result.outputPath,
          slotId: args.slot,
          date: args.date,
          privacy: args.privacy,
          syntheticDisclosure: true,
        });
        console.log(outcome.skipped ? "Already published (no duplicate created)." : "Published.");
        console.log(`YouTube:    ${outcome.url}`);
      } catch (err) {
        console.error("");
        console.error(
          `The video was generated but publishing failed: ${err instanceof Error ? err.message : String(err)}`,
        );
        console.error(`Retry with: npm run youtube -- upload --file ${result.outputPath} --slot <id> --privacy ${args.privacy}`);
        return 1;
      }
    }
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
