import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { BorderedLoader, DynamicBorder } from "@earendil-works/pi-coding-agent";
import { Container, Input, Text } from "@earendil-works/pi-tui";
import { complete, type UserMessage } from "@earendil-works/pi-ai";

const EXTRACTION_PROMPT = `You are a question extraction assistant. Given the following assistant message, extract all questions the assistant asked the user. Return ONLY a JSON array of objects with "id" (number), "question" (string), and optional "context" (relevant quote). If no questions are found, return an empty array. Output valid JSON only, no markdown fences.`;

interface ExtractedQuestion {
  id: number;
  question: string;
  context?: string;
}

function parseQuestions(text: string): ExtractedQuestion[] {
  // Strip markdown fences if present
  const cleaned = text.replace(/```(?:json)?\n?/g, "").trim();
  try {
    const parsed = JSON.parse(cleaned);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (q: unknown): q is ExtractedQuestion =>
        typeof q === "object" && q !== null &&
        typeof (q as ExtractedQuestion).id === "number" &&
        typeof (q as ExtractedQuestion).question === "string",
    );
  } catch {
    return [];
  }
}

export default function (pi: ExtensionAPI) {
  pi.registerCommand("answer", {
    description: "Extract questions from last assistant message and answer them interactively",
    handler: async (_args, ctx) => {
      if (!ctx.hasUI) {
        ctx.ui.notify("answer requires interactive mode", "error");
        return;
      }
      if (!ctx.model) {
        ctx.ui.notify("No model selected", "error");
        return;
      }

      // Find last assistant message
      const branch = ctx.sessionManager.getBranch();
      let lastText: string | undefined;
      let lastEntryId: string | undefined;

      for (let i = branch.length - 1; i >= 0; i--) {
        const entry = branch[i];
        if (entry.type !== "message") continue;
        const msg = entry.message as { role?: string; content?: Array<{ type: string; text?: string }>; stopReason?: string };
        if (msg.role !== "assistant") continue;
        const parts = (msg.content ?? []).filter((c): c is { type: "text"; text: string } => c.type === "text");
        const joined = parts.map((c) => c.text).join("\n").trim();
        if (joined.length > 0) {
          lastText = joined;
          lastEntryId = entry.id;
          break;
        }
      }

      if (!lastText || !lastEntryId) {
        ctx.ui.notify("No assistant messages found", "info");
        return;
      }

      // Extract questions via LLM with loader UI
      const questions = await ctx.ui.custom<ExtractedQuestion[] | null>((tui, theme, _kb, done) => {
        const loader = new BorderedLoader(tui, theme, "Extracting questions...");
        loader.onAbort = () => done(null);

        const doExtract = async () => {
          try {
            const auth = await ctx.modelRegistry.getApiKeyAndHeaders(ctx.model);
            if (!auth.ok) throw new Error(auth.error ?? "Auth failed");

            const response = await complete(
              ctx.model,
              {
                systemPrompt: EXTRACTION_PROMPT,
                messages: [{ role: "user" as const, content: [{ type: "text" as const, text: lastText! }] as UserMessage["content"], timestamp: Date.now() }],
              },
              { apiKey: auth.apiKey, headers: auth.headers, signal: loader.signal },
            );

            const responseText = response.content
              .filter((c): c is { type: "text"; text: string } => c.type === "text")
              .map((c) => c.text)
              .join("\n");

            done(parseQuestions(responseText));
          } catch {
            done(null);
          }
        };

        doExtract();
        return loader;
      });

      if (!questions || questions.length === 0) {
        ctx.ui.notify(questions === null ? "Cancelled" : "No questions found in last message", "info");
        return;
      }

      // Interactive Q&A for each extracted question
      const answers: string[] = new Array(questions.length).fill("");

      const result = await ctx.ui.custom<boolean>((tui, theme, _kb, done) => {
        const container = new Container();
        let currentIdx = 0;
        let inputMode = false;
        const input = new Input();

        const renderQuestion = () => {
          while (container.children.length > 0) container.removeChild(container.children[0]);

          container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));
          container.addChild(new Text(
            theme.fg("dim", `Question ${currentIdx + 1} of ${questions.length}`),
            1, 0,
          ));
          container.addChild(new Text("", 0, 0));

          const q = questions[currentIdx];
          const questionText = q.context
            ? theme.fg("dim", `"${q.context}"`) + "\n" + q.question
            : q.question;
          container.addChild(new Text(questionText, 1, 0));
          container.addChild(new Text("", 0, 0));

          if (answers[currentIdx] && !inputMode) {
            container.addChild(new Text(
              theme.fg("success", "✓ Answer: ") + answers[currentIdx],
              1, 0,
            ));
            container.addChild(new Text("", 0, 0));
          }

          container.addChild(new DynamicBorder((s: string) => theme.fg("dim", s)));

          if (inputMode) {
            container.addChild(new Text(
              theme.fg("accent", `Q${currentIdx + 1}: ${questions[currentIdx].question}`),
              1, 0,
            ));
            container.addChild(new Text("", 0, 0));
            if (answers[currentIdx]) {
              input.setValue(answers[currentIdx]);
            }
            container.addChild(input);
            container.addChild(new Text("", 0, 0));
            container.addChild(new Text(
              theme.fg("dim", "enter submit • esc back"),
              1, 0,
            ));
          } else {
            container.addChild(new Text(
              theme.fg("dim", "↑↓ navigate • a answer • ← skip • enter next • c cancel • d done"),
              1, 0,
            ));
          }

          container.addChild(new DynamicBorder((s: string) => theme.fg("dim", s)));
        };

        renderQuestion();

        return {
          render: (w) => container.render(w),
          invalidate: () => container.invalidate(),
          handleInput: (data) => {
            // While in input mode, route all keys to the embedded Input
            if (inputMode) {
              if (data === "escape") {
                inputMode = false;
                renderQuestion();
                tui.requestRender();
                return;
              }
              if (data === "enter" || data === "return") {
                answers[currentIdx] = input.getValue();
                inputMode = false;
                // Auto-advance to next question
                if (currentIdx < questions.length - 1) {
                  currentIdx++;
                }
                renderQuestion();
                tui.requestRender();
                return;
              }
              input.handleInput(data);
              return;
            }

            if (data === "c" || data === "C") {
              done(false);
              return;
            }

            if (data === "d" || data === "D") {
              done(true);
              return;
            }

            if (data === "arrowup" || data === "k") {
              if (currentIdx > 0) {
                currentIdx--;
                renderQuestion();
              }
              tui.requestRender();
              return;
            }

            if (data === "arrowdown" || data === "j") {
              if (currentIdx < questions.length - 1) {
                currentIdx++;
                renderQuestion();
              }
              tui.requestRender();
              return;
            }

            // Left arrow = skip (no answer)
            if (data === "arrowleft") {
              if (currentIdx < questions.length - 1) {
                currentIdx++;
                renderQuestion();
                tui.requestRender();
              } else {
                done(true);
              }
              return;
            }

            // Enter = next question (leave current answer as-is)
            if (data === "enter" || data === "return") {
              if (currentIdx < questions.length - 1) {
                currentIdx++;
                renderQuestion();
                tui.requestRender();
              } else {
                done(true);
              }
              return;
            }

            // 'a' = enter input mode for current question
            if (data === "a" || data === "A") {
              inputMode = true;
              input.setValue(answers[currentIdx]);
              renderQuestion();
              tui.setFocus(container);
              tui.requestRender();
              return;
            }
          },
        };
      });

      if (!result) {
        ctx.ui.notify("Cancelled", "info");
        return;
      }

      // Compile answers and submit
      const answered = questions
        .map((q, i) => answers[i] ? `**Q: ${q.question}**\nA: ${answers[i]}` : null)
        .filter(Boolean);

      if (answered.length === 0) {
        ctx.ui.notify("No answers provided", "info");
        return;
      }

      pi.sendMessage(
        {
          customType: "answers",
          content: "I answered your questions:\n\n" + answered.join("\n\n"),
          display: true,
        },
        { triggerTurn: true },
      );
    },
  });
}
