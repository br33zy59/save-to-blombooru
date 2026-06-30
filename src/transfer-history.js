const TRANSFER_HISTORY_STORAGE_KEY = "transferHistory";
const TRANSFER_HISTORY_MAX_ENTRIES = 8;

const TRANSFER_STATUS_PENDING = "pending";
const TRANSFER_STATUS_SUCCESS = "success";
const TRANSFER_STATUS_FAILURE = "failure";

function createTransferId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

async function readTransferHistory() {
  const data = await browser.storage.session.get(TRANSFER_HISTORY_STORAGE_KEY);

  return data[TRANSFER_HISTORY_STORAGE_KEY] || [];
}

async function writeTransferHistory(entries) {
  await browser.storage.session.set({
    [TRANSFER_HISTORY_STORAGE_KEY]: entries.slice(0, TRANSFER_HISTORY_MAX_ENTRIES)
  });
}

async function beginTransferEntry({ srcUrl, thumbUrl, serverId }) {
  const entry = {
    id: createTransferId(),
    srcUrl: srcUrl || "",
    thumbUrl: thumbUrl || srcUrl || "",
    serverId: serverId || "",
    status: TRANSFER_STATUS_PENDING,
    startedAt: Date.now()
  };

  const entries = await readTransferHistory();
  entries.unshift(entry);
  await writeTransferHistory(entries);

  return entry.id;
}

async function finishTransferEntry(
  transferId,
  status,
  errorMessage = "",
  extra = {}
) {
  if (!transferId) {
    return;
  }

  const entries = await readTransferHistory();
  const index = entries.findIndex((entry) => entry.id === transferId);

  if (index < 0) {
    return;
  }

  entries[index] = {
    ...entries[index],
    status,
    finishedAt: Date.now(),
    ...(errorMessage ? { errorMessage } : {}),
    ...extra
  };

  await writeTransferHistory(entries);
}
