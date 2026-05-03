import ActionCenter from "@/components/ActionCenter";
import GmailSyncControl from "@/components/GmailSyncControl";
import SmartInbox from "@/components/SmartInbox";

export default function RemindersInbox() {
  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <GmailSyncControl />
      <div className="grid min-h-0 flex-1 gap-4 md:grid-cols-2">
        <div className="min-h-0 overflow-hidden pr-0 md:border-r md:pr-4" style={{ borderColor: "rgba(255,255,255,0.07)" }}>
          <ActionCenter />
        </div>
        <div className="min-h-0 overflow-hidden">
          <SmartInbox />
        </div>
      </div>
    </div>
  );
}
