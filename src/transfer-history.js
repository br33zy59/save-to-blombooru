const TRANSFER_HISTORY_STORAGE_KEY = "transferHistory";
const TRANSFER_HISTORY_MAX_ENTRIES = 8;

const TRANSFER_STATUS_PENDING = "pending";
const TRANSFER_STATUS_SUCCESS = "success";
const TRANSFER_STATUS_FAILURE = "failure";

function isVideoPreviewUrl(url) {
  if (!url) {
    return false;
  }

  try {
    return /\.(mp4|webm|m4v|mov)(\?|$)/i.test(new URL(url).pathname);
  } catch (err) {
    return /\.(mp4|webm|m4v|mov)(\?|$)/i.test(url);
  }
}

function formatFileByteSize(bytes) {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) {
    return "";
  }

  if (bytes < 1024) {
    return `${bytes} B`;
  }

  const kb = bytes / 1024;

  if (kb < 1024) {
    return `${kb >= 100 ? Math.round(kb) : kb.toFixed(1)} KB`;
  }

  const mb = kb / 1024;

  if (mb < 1024) {
    return `${mb >= 100 ? Math.round(mb) : mb.toFixed(1)} MB`;
  }

  const gb = mb / 1024;

  return `${gb >= 100 ? Math.round(gb) : gb.toFixed(2)} GB`;
}

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

async function beginTransferEntry({ srcUrl, serverId }) {
  const entry = {
    id: createTransferId(),
    srcUrl: srcUrl || "",
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

async function updateTransferEntryByteSize(transferId, byteSize) {
  if (!transferId || !Number.isFinite(byteSize) || byteSize < 0) {
    return;
  }

  const entries = await readTransferHistory();
  const index = entries.findIndex((entry) => entry.id === transferId);

  if (index < 0) {
    return;
  }

  entries[index] = {
    ...entries[index],
    byteSize
  };

  await writeTransferHistory(entries);
}

async function clearTransferHistory() {
  await writeTransferHistory([]);
}
