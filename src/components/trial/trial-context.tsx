"use client";

import {
  ReactNode,
  createContext,
  useContext,
  useMemo,
  useState,
} from "react";
import {
  ChatProviderId,
  getDefaultChatProvider,
} from "@/config/chat-providers";

type TrialContextValue = {
  provider: ChatProviderId;
  setProvider: (provider: ChatProviderId) => void;
  transcript: string;
  setTranscript: (value: string) => void;
};

const TrialContext = createContext<TrialContextValue | undefined>(undefined);

export function TrialContextProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [provider, setProvider] =
    useState<ChatProviderId>(getDefaultChatProvider());
  const [transcript, setTranscript] = useState("");

  const value = useMemo(
    () => ({
      provider,
      setProvider,
      transcript,
      setTranscript,
    }),
    [provider, transcript]
  );

  return (
    <TrialContext.Provider value={value}>{children}</TrialContext.Provider>
  );
}

export function useTrialContext() {
  const context = useContext(TrialContext);
  if (!context) {
    throw new Error(
      "useTrialContext must be used within a TrialContextProvider"
    );
  }
  return context;
}
