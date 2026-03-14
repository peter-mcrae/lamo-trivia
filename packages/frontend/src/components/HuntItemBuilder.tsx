import type { HuntItem, HuntClue } from '@lamo-trivia/shared';
import { HUNT_LIMITS } from '@lamo-trivia/shared';

interface HuntItemBuilderProps {
  item: HuntItem;
  onChange: (item: HuntItem) => void;
  onRemove: () => void;
  index: number;
}

export function HuntItemBuilder({ item, onChange, onRemove, index }: HuntItemBuilderProps) {
  const updateDescription = (description: string) => {
    onChange({ ...item, description });
  };

  const addClue = () => {
    if (item.clues.length >= HUNT_LIMITS.maxCluesPerItem) return;
    const newClue: HuntClue = {
      id: crypto.randomUUID(),
      text: '',
      pointCost: 200,
    };
    onChange({ ...item, clues: [...item.clues, newClue] });
  };

  const updateClue = (clueIndex: number, updates: Partial<HuntClue>) => {
    const updatedClues = item.clues.map((clue, i) =>
      i === clueIndex ? { ...clue, ...updates } : clue,
    );
    onChange({ ...item, clues: updatedClues });
  };

  const removeClue = (clueIndex: number) => {
    onChange({ ...item, clues: item.clues.filter((_, i) => i !== clueIndex) });
  };

  return (
    <div className="border border-lamo-border rounded-xl p-4 space-y-4 bg-white">
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-lamo-dark">Item {index + 1}</span>
        <button
          type="button"
          onClick={onRemove}
          className="text-xs text-red-500 hover:text-red-700 transition-colors"
        >
          Remove Item
        </button>
      </div>

      {/* Description */}
      <div>
        <label className="block text-sm font-medium text-lamo-dark mb-1.5">
          Description
        </label>
        <input
          type="text"
          value={item.description}
          onChange={(e) => updateDescription(e.target.value)}
          placeholder="e.g. Find something red in the kitchen"
          maxLength={HUNT_LIMITS.maxDescriptionLength}
          required
          className="w-full px-4 py-2.5 border border-lamo-border rounded-xl text-lamo-dark placeholder:text-lamo-gray-muted focus:outline-none focus:ring-2 focus:ring-lamo-blue/40"
        />
        <p className="text-xs text-lamo-gray-muted mt-1">
          {item.description.length}/{HUNT_LIMITS.maxDescriptionLength}
        </p>
      </div>

      {/* Clues */}
      {item.clues.length > 0 && (
        <div className="space-y-3">
          <label className="block text-sm font-medium text-lamo-dark">Clues</label>
          {item.clues.map((clue, clueIndex) => (
            <div
              key={clue.id}
              className="flex items-start gap-2 border border-lamo-border rounded-xl p-3 bg-lamo-bg"
            >
              <div className="flex-1 space-y-2">
                <input
                  type="text"
                  value={clue.text}
                  onChange={(e) => updateClue(clueIndex, { text: e.target.value })}
                  placeholder={`Clue ${clueIndex + 1}`}
                  maxLength={HUNT_LIMITS.maxClueLength}
                  className="w-full px-3 py-2 border border-lamo-border rounded-xl text-sm text-lamo-dark placeholder:text-lamo-gray-muted focus:outline-none focus:ring-2 focus:ring-lamo-blue/40"
                />
                <div className="flex items-center gap-2">
                  <label className="text-xs text-lamo-gray-muted whitespace-nowrap">
                    Point cost
                  </label>
                  <input
                    type="number"
                    value={clue.pointCost}
                    onChange={(e) =>
                      updateClue(clueIndex, {
                        pointCost: Math.max(0, Math.min(500, Number(e.target.value))),
                      })
                    }
                    min={0}
                    max={500}
                    className="w-20 px-2 py-1 border border-lamo-border rounded-lg text-sm text-lamo-dark text-center focus:outline-none focus:ring-2 focus:ring-lamo-blue/40"
                  />
                </div>
              </div>
              <button
                type="button"
                onClick={() => removeClue(clueIndex)}
                className="text-xs text-red-500 hover:text-red-700 transition-colors mt-2"
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Add Clue Button */}
      {item.clues.length < HUNT_LIMITS.maxCluesPerItem && (
        <button
          type="button"
          onClick={addClue}
          className="text-sm text-lamo-blue hover:text-lamo-blue-dark transition-colors font-medium"
        >
          + Add Clue
        </button>
      )}
    </div>
  );
}
