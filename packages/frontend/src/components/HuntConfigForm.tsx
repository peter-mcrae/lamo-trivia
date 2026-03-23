import { useState } from 'react';
import type { HuntItem, HuntClue, HuntConfig } from '@lamo-trivia/shared';
import type { HuntConfigInput } from '@lamo-trivia/shared';
import { HUNT_DEFAULTS, HUNT_LIMITS } from '@lamo-trivia/shared';
import { HuntItemBuilder } from '@/components/HuntItemBuilder';

interface HuntConfigFormProps {
  /** Pre-fill values (e.g. for editing). Omit to use HUNT_DEFAULTS. */
  initialConfig?: Partial<HuntConfig>;
  submitLabel: string;
  submittingLabel: string;
  onSubmit: (config: HuntConfigInput) => void | Promise<void>;
  submitting: boolean;
  error?: string;
  showCreditEstimate?: boolean;
  userCredits?: number;
  /** Optional cancel handler — renders a cancel button if provided */
  onCancel?: () => void;
}

function createEmptyItem(): HuntItem {
  return {
    id: crypto.randomUUID(),
    description: '',
    basePoints: HUNT_DEFAULTS.basePointsPerItem,
    clues: [],
  };
}

function buildAIPrompt(huntName: string): string {
  return `I'm creating a scavenger hunt${huntName ? ` called "${huntName}"` : ''}. Generate a list of items for players to find and photograph.

For each item, provide:
- A clear description of what to find/photograph (be specific enough that an AI vision model can verify the photo)
- 1-3 optional clues (hints that help players find the item, each with a point cost)

Respond with ONLY valid JSON in this exact format — no markdown, no code fences, no explanation:

[
  {
    "description": "A red fire hydrant on a street corner",
    "clues": [
      { "text": "Look near the intersection of two busy streets", "pointCost": 200 },
      { "text": "It's within 2 blocks of the park entrance", "pointCost": 100 }
    ]
  },
  {
    "description": "A dog wearing a bandana or accessory",
    "clues": [
      { "text": "Try the dog park or a pet-friendly cafe", "pointCost": 150 }
    ]
  }
]

Rules:
- Generate 5-${HUNT_LIMITS.maxItems} items
- Max ${HUNT_LIMITS.maxCluesPerItem} clues per item
- Descriptions should be things that can be visually verified in a photo
- Clue pointCost should be between 50-500 (higher = more helpful hint)
- Items can have 0 clues if they're straightforward`;
}

function parseAIItems(json: string): HuntItem[] {
  // Strip markdown code fences if present
  const cleaned = json.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
  const parsed = JSON.parse(cleaned);

  if (!Array.isArray(parsed)) {
    throw new Error('Expected a JSON array');
  }

  return parsed.slice(0, HUNT_LIMITS.maxItems).map((raw: any) => ({
    id: crypto.randomUUID(),
    description: String(raw.description || '').slice(0, HUNT_LIMITS.maxDescriptionLength),
    basePoints: HUNT_DEFAULTS.basePointsPerItem,
    clues: (Array.isArray(raw.clues) ? raw.clues : [])
      .slice(0, HUNT_LIMITS.maxCluesPerItem)
      .map((c: any): HuntClue => ({
        id: crypto.randomUUID(),
        text: String(c.text || '').slice(0, HUNT_LIMITS.maxClueLength),
        pointCost: Math.max(0, Math.min(500, Number(c.pointCost) || HUNT_DEFAULTS.hintPointCost)),
      })),
  }));
}

export function HuntConfigForm({
  initialConfig,
  submitLabel,
  submittingLabel,
  onSubmit,
  submitting,
  error: externalError,
  showCreditEstimate,
  userCredits,
  onCancel,
}: HuntConfigFormProps) {
  const [internalError, setInternalError] = useState('');
  const [promptCopied, setPromptCopied] = useState(false);
  const [showPasteInput, setShowPasteInput] = useState(false);
  const [pasteValue, setPasteValue] = useState('');
  const [pasteError, setPasteError] = useState('');

  const [name, setName] = useState(initialConfig?.name ?? '');
  const [durationMinutes, setDurationMinutes] = useState<number>(initialConfig?.durationMinutes ?? HUNT_DEFAULTS.durationMinutes);
  const [items, setItems] = useState<HuntItem[]>(
    initialConfig?.items?.length
      ? initialConfig.items.map((item) => ({ ...item, clues: item.clues ?? [] }))
      : [createEmptyItem()],
  );
  const [basePointsPerItem, setBasePointsPerItem] = useState<number>(initialConfig?.basePointsPerItem ?? HUNT_DEFAULTS.basePointsPerItem);
  const [hintPointCost, setHintPointCost] = useState<number>(initialConfig?.hintPointCost ?? HUNT_DEFAULTS.hintPointCost);
  const [maxRetries, setMaxRetries] = useState<number>(initialConfig?.maxRetries ?? HUNT_DEFAULTS.maxRetries);
  const [minPlayers, setMinPlayers] = useState<number>(initialConfig?.minPlayers ?? HUNT_DEFAULTS.minPlayers);
  const [maxPlayers, setMaxPlayers] = useState<number>(initialConfig?.maxPlayers ?? HUNT_DEFAULTS.maxPlayers);
  const [savePhotos, setSavePhotos] = useState(initialConfig?.savePhotos ?? false);

  const error = externalError || internalError;

  const addItem = () => {
    if (items.length >= HUNT_LIMITS.maxItems) return;
    setItems([...items, createEmptyItem()]);
  };

  const updateItem = (index: number, updatedItem: HuntItem) => {
    setItems(items.map((item, i) => (i === index ? updatedItem : item)));
  };

  const removeItem = (index: number) => {
    if (items.length <= 1) return;
    setItems(items.filter((_, i) => i !== index));
  };

  const handleCopyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(buildAIPrompt(name));
      setPromptCopied(true);
      setTimeout(() => setPromptCopied(false), 2000);
    } catch {
      // Fallback: select text in a temporary textarea
    }
  };

  const handlePasteItems = () => {
    setPasteError('');
    try {
      const newItems = parseAIItems(pasteValue);
      if (newItems.length === 0) {
        setPasteError('No items found in JSON');
        return;
      }
      setItems(newItems);
      setShowPasteInput(false);
      setPasteValue('');
    } catch {
      setPasteError('Invalid JSON. Make sure you copied the full response.');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setInternalError('');

    if (!name.trim()) {
      setInternalError('Give your hunt a name');
      return;
    }

    const emptyItems = items.filter((item) => !item.description.trim());
    if (emptyItems.length > 0) {
      setInternalError('All items must have a description');
      return;
    }

    const invalidClues = items.some((item) =>
      item.clues.some((clue) => !clue.text.trim()),
    );
    if (invalidClues) {
      setInternalError('All clues must have text');
      return;
    }

    await onSubmit({
      name: name.trim(),
      items: items.map((item) => ({
        ...item,
        description: item.description.trim(),
        basePoints: basePointsPerItem,
        clues: item.clues.map((clue) => ({
          ...clue,
          text: clue.text.trim(),
        })),
      })),
      durationMinutes,
      maxRetries,
      basePointsPerItem,
      hintPointCost,
      minPlayers,
      maxPlayers,
      isPrivate: false,
      savePhotos,
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Hunt Name */}
      <div>
        <label className="block text-sm font-medium text-lamo-dark mb-1.5">Hunt Name</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Backyard Adventure"
          maxLength={50}
          className="w-full px-4 py-2.5 border border-lamo-border rounded-xl text-lamo-dark placeholder:text-lamo-gray-muted focus:outline-none focus:ring-2 focus:ring-lamo-blue/40"
        />
      </div>

      {/* Duration */}
      <div>
        <label className="block text-sm font-medium text-lamo-dark mb-1.5">
          Duration{' '}
          <span className="text-lamo-gray-muted font-normal">({durationMinutes} min)</span>
        </label>
        <input
          type="range"
          min={HUNT_LIMITS.minDuration}
          max={HUNT_LIMITS.maxDuration}
          step={5}
          value={durationMinutes}
          onChange={(e) => setDurationMinutes(Number(e.target.value))}
          className="w-full accent-lamo-blue"
        />
        <div className="flex justify-between text-xs text-lamo-gray-muted mt-1">
          <span>{HUNT_LIMITS.minDuration} min</span>
          <span>{HUNT_LIMITS.maxDuration} min</span>
        </div>
      </div>

      {/* Hunt Items */}
      <div>
        <div className="flex items-center justify-between mb-1.5">
          <label className="block text-sm font-medium text-lamo-dark">
            Items{' '}
            <span className="text-lamo-gray-muted font-normal">
              ({items.length}/{HUNT_LIMITS.maxItems})
            </span>
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleCopyPrompt}
              className="text-xs px-2.5 py-1 rounded-full bg-lamo-blue/10 text-lamo-blue font-medium hover:bg-lamo-blue/20 transition-colors"
            >
              {promptCopied ? 'Copied!' : 'Copy AI Prompt'}
            </button>
            <button
              type="button"
              onClick={() => { setShowPasteInput(!showPasteInput); setPasteError(''); }}
              className="text-xs px-2.5 py-1 rounded-full bg-lamo-blue/10 text-lamo-blue font-medium hover:bg-lamo-blue/20 transition-colors"
            >
              {showPasteInput ? 'Cancel' : 'Paste JSON'}
            </button>
          </div>
        </div>

        {showPasteInput && (
          <div className="mb-3 p-3 border border-lamo-border rounded-xl bg-lamo-bg space-y-2">
            <p className="text-xs text-lamo-gray-muted">
              Paste the JSON array from your AI assistant below. This will replace all current items.
            </p>
            <textarea
              value={pasteValue}
              onChange={(e) => setPasteValue(e.target.value)}
              placeholder='[{ "description": "...", "clues": [...] }]'
              rows={6}
              className="w-full px-3 py-2 border border-lamo-border rounded-xl text-sm text-lamo-dark font-mono placeholder:text-lamo-gray-muted focus:outline-none focus:ring-2 focus:ring-lamo-blue/40 resize-y"
            />
            {pasteError && <p className="text-xs text-red-500">{pasteError}</p>}
            <button
              type="button"
              onClick={handlePasteItems}
              disabled={!pasteValue.trim()}
              className="px-4 py-2 bg-lamo-blue text-white text-sm font-semibold rounded-pill hover:bg-lamo-blue-dark transition-colors disabled:opacity-50"
            >
              Import Items
            </button>
          </div>
        )}

        <div className="space-y-3">
          {items.map((item, index) => (
            <HuntItemBuilder
              key={item.id}
              item={item}
              onChange={(updated) => updateItem(index, updated)}
              onRemove={() => removeItem(index)}
              index={index}
            />
          ))}
        </div>
        {items.length < HUNT_LIMITS.maxItems && (
          <button
            type="button"
            onClick={addItem}
            className="mt-3 w-full px-4 py-2.5 border border-dashed border-lamo-border rounded-xl text-sm text-lamo-blue font-medium hover:bg-lamo-bg transition-colors"
          >
            + Add Item
          </button>
        )}
      </div>

      {/* Scoring Settings */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-lamo-dark mb-1.5">
            Base Points per Item
          </label>
          <input
            type="number"
            value={basePointsPerItem}
            onChange={(e) =>
              setBasePointsPerItem(Math.max(100, Math.min(5000, Number(e.target.value))))
            }
            min={100}
            max={5000}
            step={100}
            className="w-full px-4 py-2.5 border border-lamo-border rounded-xl text-lamo-dark focus:outline-none focus:ring-2 focus:ring-lamo-blue/40"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-lamo-dark mb-1.5">
            Hint Point Cost
          </label>
          <input
            type="number"
            value={hintPointCost}
            onChange={(e) =>
              setHintPointCost(Math.max(0, Math.min(500, Number(e.target.value))))
            }
            min={0}
            max={500}
            step={50}
            className="w-full px-4 py-2.5 border border-lamo-border rounded-xl text-lamo-dark focus:outline-none focus:ring-2 focus:ring-lamo-blue/40"
          />
        </div>
      </div>

      {/* Max Retries */}
      <div>
        <label className="block text-sm font-medium text-lamo-dark mb-1.5">
          Photo Verification Retries{' '}
          <span className="text-lamo-gray-muted font-normal">({maxRetries})</span>
        </label>
        <p className="text-xs text-lamo-gray-muted mb-1.5">
          How many times a player can re-submit a photo for AI verification per item
        </p>
        <input
          type="range"
          min={1}
          max={5}
          step={1}
          value={maxRetries}
          onChange={(e) => setMaxRetries(Number(e.target.value))}
          className="w-full accent-lamo-blue"
        />
        <div className="flex justify-between text-xs text-lamo-gray-muted mt-1">
          <span>1</span>
          <span>5</span>
        </div>
      </div>

      {/* Players */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-sm font-medium text-lamo-dark mb-1.5">Min Teams</label>
          <select
            value={minPlayers}
            onChange={(e) => setMinPlayers(Number(e.target.value))}
            className="w-full px-3 py-2.5 border border-lamo-border rounded-xl text-lamo-dark bg-white focus:outline-none focus:ring-2 focus:ring-lamo-blue/40"
          >
            {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-lamo-dark mb-1.5">Max Teams</label>
          <select
            value={maxPlayers}
            onChange={(e) => setMaxPlayers(Number(e.target.value))}
            className="w-full px-3 py-2.5 border border-lamo-border rounded-xl text-lamo-dark bg-white focus:outline-none focus:ring-2 focus:ring-lamo-blue/40"
          >
            {[2, 3, 4, 5, 6, 7, 8, 10, 12].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Save Photos */}
      <div className="flex items-center justify-between">
        <div>
          <label className="block text-sm font-medium text-lamo-dark">Save Photos in History</label>
          <p className="text-xs text-lamo-gray-muted mt-0.5">
            Keep submitted photos viewable in the hunt history after the game ends
          </p>
        </div>
        <button
          type="button"
          onClick={() => setSavePhotos(!savePhotos)}
          className={`relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors ${
            savePhotos ? 'bg-lamo-blue' : 'bg-lamo-border'
          }`}
        >
          <span
            className={`inline-block h-5 w-5 rounded-full bg-white shadow transform transition-transform mt-0.5 ${
              savePhotos ? 'translate-x-[22px]' : 'translate-x-0.5'
            }`}
          />
        </button>
      </div>

      {/* Credit Estimate */}
      {showCreditEstimate && (
        <div className={`p-4 rounded-xl border ${
          userCredits != null && userCredits < items.length * maxRetries * maxPlayers
            ? 'border-red-200 bg-red-50'
            : 'border-lamo-border bg-lamo-bg'
        }`}>
          <p className="text-sm font-medium text-lamo-dark">
            Estimated credits needed:{' '}
            <strong>{items.length * maxRetries * maxPlayers}</strong>
          </p>
          <p className="text-xs text-lamo-gray-muted mt-1">
            {items.length} items &times; {maxRetries} retries &times; {maxPlayers} max teams
          </p>
          {userCredits != null && userCredits < items.length * maxRetries * maxPlayers && (
            <p className="text-xs text-red-500 mt-1">
              Not enough credits. You have {userCredits}.
            </p>
          )}
        </div>
      )}

      {/* Error */}
      {error && <p className="text-red-500 text-sm">{error}</p>}

      {/* Submit / Cancel */}
      <div className={onCancel ? 'flex gap-3' : ''}>
        <button
          type="submit"
          disabled={submitting || (showCreditEstimate && userCredits != null && userCredits < items.length * maxRetries * maxPlayers)}
          className={`${onCancel ? 'flex-1' : 'w-full'} px-6 py-3 bg-lamo-blue text-white font-semibold rounded-pill hover:bg-lamo-blue-dark transition-colors disabled:opacity-50`}
        >
          {submitting ? submittingLabel : submitLabel}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="px-6 py-3 border border-lamo-border text-lamo-dark font-semibold rounded-pill hover:bg-lamo-bg transition-colors"
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
