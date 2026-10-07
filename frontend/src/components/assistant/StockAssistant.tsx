/**
 * The stock assistant: a chat panel for one stock.
 *
 * It answers from a briefing the server builds for this stock and this user
 * (prices, fundamentals, their position and journal, headlines). With an AI
 * key on the server the answers come from Gemini or Claude; without one, the
 * suggested questions are answered straight from the data.
 */
import { Sparkles } from "lucide-react";
import { useCallback, useState } from "react";
import { askAssistant, type AssistantQuestion } from "@/lib/api";
import { useAssistantOpening, useMe } from "@/lib/queries";
import type { AssistantEvent } from "@/lib/types";
import { Button } from "../ui";
import { ChatDrawer, ChatPanel } from "./Chat";

function Panel({ symbol, name, onClose }: { symbol: string; name: string; onClose: () => void }) {
  const opening = useAssistantOpening(symbol, true);
  const send = useCallback(
    (body: AssistantQuestion, onEvent: (event: AssistantEvent) => void, signal: AbortSignal) => askAssistant(symbol, body, onEvent, signal),
    [symbol],
  );
  return (
    <ChatPanel
      storageKey={`wealthos.assistant.${symbol}`}
      title={`Ask about ${symbol}`}
      subtitle={name}
      opening={opening}
      send={send}
      placeholder={`Ask anything about ${symbol}`}
      footnote="Explains the data and its context. Not investment advice."
      onClose={onClose}
    />
  );
}

/** The "Ask AI" button for a stock page, with the chat panel it opens. */
export function StockAssistant({ symbol, name }: { symbol: string; name: string }) {
  const [open, setOpen] = useState(false);
  const me = useMe();
  return (
    <ChatDrawer
      open={open}
      onOpenChange={setOpen}
      trigger={
        <Button data-tour="ask-ai" className="border-accent/40 text-accent hover:bg-accent-soft" icon={<Sparkles className="size-4" />}>
          {me.data?.assistant ? "Ask AI" : "Ask assistant"}
        </Button>
      }
    >
      <Panel key={symbol} symbol={symbol} name={name} onClose={() => setOpen(false)} />
    </ChatDrawer>
  );
}
