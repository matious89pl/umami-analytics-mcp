import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { UmamiContext } from "../server";

const daysArg = {
  days: z.string().optional().describe("Look-back window in days (default 30)."),
} as const;

function userMessage(text: string) {
  return { messages: [{ role: "user" as const, content: { type: "text" as const, text } }] };
}

/** Server-side prompts that teach the model the correct tool-chaining for
 * common analytics tasks. */
export function registerPrompts(server: McpServer, _ctx: UmamiContext): void {
  server.registerPrompt(
    "analytics_report",
    { title: "Analytics report", description: "Full traffic report for a website over N days.", argsSchema: daysArg },
    (args) => {
      const days = args.days ?? "30";
      return userMessage(
        `Produce an analytics report for the last ${days} days.\n` +
          `1) Call list_websites and pick the site (ask me if there are several).\n` +
          `2) get_stats with compare="prev" for the headline numbers and period-over-period change.\n` +
          `3) get_pageviews (unit="day") for the trend.\n` +
          `4) get_metrics for type "url", "referrer", "browser", and "country".\n` +
          `Summarize traffic, the trend vs the previous period, top pages, top referrers, and audience. Call out anything anomalous.`,
      );
    },
  );

  server.registerPrompt(
    "traffic_overview",
    { title: "Traffic overview", description: "Quick traffic snapshot.", argsSchema: daysArg },
    (args) =>
      userMessage(
        `Give a concise traffic overview for the last ${args.days ?? "7"} days: call list_websites, then get_stats and get_pageviews (unit="day"). Report pageviews, visitors, bounce rate, and the day-by-day trend.`,
      ),
  );

  server.registerPrompt(
    "top_pages",
    {
      title: "Top pages",
      description: "Most-visited pages.",
      argsSchema: { ...daysArg, limit: z.string().optional().describe("How many pages (default 10).") },
    },
    (args) =>
      userMessage(
        `List the top ${args.limit ?? "10"} pages over the last ${args.days ?? "7"} days: list_websites, then get_metrics(type="url", limit=${args.limit ?? "10"}). Present a ranked table of path and pageviews.`,
      ),
  );

  server.registerPrompt(
    "acquisition_channels",
    { title: "Acquisition channels", description: "Where traffic comes from.", argsSchema: daysArg },
    (args) =>
      userMessage(
        `Analyze acquisition for the last ${args.days ?? "30"} days: list_websites, then get_metrics for type "referrer", "channel", and "domain", plus report_utm. Summarize the main channels and notable referrers.`,
      ),
  );

  server.registerPrompt(
    "realtime_check",
    { title: "Realtime check", description: "Who's on the site right now.", argsSchema: {} },
    () =>
      userMessage(
        `Check live traffic: list_websites, then get_active_visitors and get_realtime for the chosen site. Report current active visitors and what they're doing.`,
      ),
  );

  server.registerPrompt(
    "funnel_analysis",
    {
      title: "Funnel analysis",
      description: "Conversion funnel across steps.",
      argsSchema: {
        ...daysArg,
        steps: z.string().optional().describe('Comma-separated steps, e.g. "/pricing,/signup,signup-event".'),
      },
    },
    (args) =>
      userMessage(
        `Build a conversion funnel over the last ${args.days ?? "30"} days for these steps: ${args.steps ?? "(ask me for the steps)"}. Use list_websites then report_funnel (each step is {type:'url'|'event', value}). Report step-by-step conversion and the biggest drop-off.`,
      ),
  );

  server.registerPrompt(
    "retention_analysis",
    { title: "Retention analysis", description: "Returning-visitor retention.", argsSchema: daysArg },
    (args) =>
      userMessage(
        `Analyze retention over the last ${args.days ?? "30"} days: list_websites then report_retention. Explain how well visitors return and any cohort patterns.`,
      ),
  );

  server.registerPrompt(
    "audience_insights",
    { title: "Audience insights", description: "Who the visitors are.", argsSchema: daysArg },
    (args) =>
      userMessage(
        `Profile the audience for the last ${args.days ?? "30"} days: list_websites, then get_metrics for "country", "device", "browser", "os", and "language". Summarize the dominant segments.`,
      ),
  );

  server.registerPrompt(
    "compare_periods",
    { title: "Compare periods", description: "This period vs the previous.", argsSchema: daysArg },
    (args) =>
      userMessage(
        `Compare the last ${args.days ?? "30"} days with the preceding period: list_websites then get_stats with compare="prev". Report each metric's change and what likely drove it.`,
      ),
  );
}
