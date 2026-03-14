import { useState, useEffect } from 'react';
import { GAME_DEFAULTS, SCORING_METHODS } from '@lamo-trivia/shared';
import type { GameConfig, TriviaCategory, ScoringMethod } from '@lamo-trivia/shared';
import type { GameConfigInput } from '@lamo-trivia/shared';
import { api } from '@/lib/api';

interface GameConfigFormProps {
  /** Pre-fill values (e.g. for rematch). Omit to use GAME_DEFAULTS. */
  initialConfig?: Partial<GameConfig>;
  /** Submit button label */
  submitLabel: string;
  /** Loading state label for submit button */
  submittingLabel: string;
  /** Called when the form is valid and submitted */
  onSubmit: (config: GameConfigInput) => void | Promise<void>;
  /** Whether the form is currently submitting */
  submitting: boolean;
  /** External error message to display */
  error?: string;
  /** Optional cancel handler — renders a cancel button if provided */
  onCancel?: () => void;
}

export function GameConfigForm({
  initialConfig,
  submitLabel,
  submittingLabel,
  onSubmit,
  submitting,
  error: externalError,
  onCancel,
}: GameConfigFormProps) {
  const [categories, setCategories] = useState<TriviaCategory[]>([]);
  const [internalError, setInternalError] = useState('');

  const [name, setName] = useState(initialConfig?.name ?? '');
  const [useAI, setUseAI] = useState(!!initialConfig?.aiTopic);
  const [aiTopic, setAiTopic] = useState(initialConfig?.aiTopic ?? '');
  const [selectedCategories, setSelectedCategories] = useState<string[]>(
    initialConfig?.categoryIds ?? [],
  );
  const [questionCount, setQuestionCount] = useState(
    initialConfig?.questionCount ?? GAME_DEFAULTS.questionCount,
  );
  const [timePerQuestion, setTimePerQuestion] = useState(
    initialConfig?.timePerQuestion ?? GAME_DEFAULTS.timePerQuestion,
  );
  const [minPlayers, setMinPlayers] = useState(
    initialConfig?.minPlayers ?? GAME_DEFAULTS.minPlayers,
  );
  const [maxPlayers, setMaxPlayers] = useState(
    initialConfig?.maxPlayers ?? GAME_DEFAULTS.maxPlayers,
  );
  const [scoringMethod, setScoringMethod] = useState<ScoringMethod>(
    initialConfig?.scoringMethod ?? GAME_DEFAULTS.scoringMethod,
  );
  const [streakBonus, setStreakBonus] = useState(
    initialConfig?.streakBonus ?? GAME_DEFAULTS.streakBonus,
  );
  const [showAnswers, setShowAnswers] = useState(
    initialConfig?.showAnswers ?? GAME_DEFAULTS.showAnswers,
  );
  const [timeBetweenQuestions, setTimeBetweenQuestions] = useState(
    initialConfig?.timeBetweenQuestions ?? GAME_DEFAULTS.timeBetweenQuestions,
  );
  const [isPrivate, setIsPrivate] = useState(initialConfig?.isPrivate ?? false);

  useEffect(() => {
    api.getCategories().then((res) => setCategories(res.categories));
  }, []);

  const toggleCategory = (id: string) => {
    setSelectedCategories((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id],
    );
  };

  const totalAvailable = categories
    .filter((c) => selectedCategories.includes(c.id))
    .reduce((sum, c) => sum + c.questionCount, 0);

  const error = externalError || internalError;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setInternalError('');

    if (!name.trim()) {
      setInternalError('Give your game a name');
      return;
    }

    if (useAI) {
      if (!aiTopic.trim()) {
        setInternalError('Enter a topic for AI-generated questions');
        return;
      }
    } else {
      if (selectedCategories.length === 0) {
        setInternalError('Select at least one category');
        return;
      }
      if (totalAvailable < questionCount) {
        setInternalError(`Only ${totalAvailable} questions available in selected categories`);
        return;
      }
    }

    await onSubmit({
      name: name.trim(),
      categoryIds: useAI ? [] : selectedCategories,
      questionCount,
      minPlayers,
      maxPlayers,
      timePerQuestion,
      scoringMethod,
      streakBonus,
      showAnswers,
      timeBetweenQuestions,
      isPrivate,
      ...(useAI ? { aiTopic: aiTopic.trim() } : {}),
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Game Name */}
      <div>
        <label htmlFor="game-name" className="block text-sm font-medium text-lamo-dark mb-1.5">Game Name</label>
        <input
          id="game-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Friday Night Trivia"
          maxLength={50}
          className="w-full px-4 py-2.5 border border-lamo-border rounded-xl text-lamo-dark placeholder:text-lamo-gray-muted focus:outline-none focus:ring-2 focus:ring-lamo-blue/40"
        />
      </div>

      {/* Question Source Toggle */}
      <div>
        <label className="block text-sm font-medium text-lamo-dark mb-1.5">Question Source</label>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setUseAI(false)}
            className={`px-3 py-2.5 rounded-xl border text-left text-sm transition-colors ${
              !useAI
                ? 'border-lamo-blue bg-lamo-blue/5 text-lamo-dark'
                : 'border-lamo-border bg-white text-lamo-dark hover:border-lamo-blue/40'
            }`}
          >
            <div className="font-medium">Pick Categories</div>
            <div className="text-xs text-lamo-gray-muted">Pre-made question sets</div>
          </button>
          <button
            type="button"
            onClick={() => setUseAI(true)}
            className={`px-3 py-2.5 rounded-xl border text-left text-sm transition-colors ${
              useAI
                ? 'border-lamo-blue bg-lamo-blue/5 text-lamo-dark'
                : 'border-lamo-border bg-white text-lamo-dark hover:border-lamo-blue/40'
            }`}
          >
            <div className="font-medium">AI Generated</div>
            <div className="text-xs text-lamo-gray-muted">Custom topic, fresh questions</div>
          </button>
        </div>
      </div>

      {/* Categories (when not AI) */}
      {!useAI && (
        <div>
          <label className="block text-sm font-medium text-lamo-dark mb-1.5">
            Categories
            {selectedCategories.length > 0 && (
              <span className="text-lamo-gray-muted font-normal"> — {totalAvailable} questions available</span>
            )}
          </label>
          <div className="grid grid-cols-2 gap-2">
            {categories.map((cat) => {
              const selected = selectedCategories.includes(cat.id);
              const disabled = cat.questionCount === 0;
              return (
                <button
                  key={cat.id}
                  type="button"
                  disabled={disabled}
                  onClick={() => toggleCategory(cat.id)}
                  className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border text-left text-sm transition-colors ${
                    selected
                      ? 'border-lamo-blue bg-lamo-blue/5 text-lamo-dark'
                      : disabled
                        ? 'border-lamo-border bg-lamo-bg text-lamo-gray-muted cursor-not-allowed opacity-50'
                        : 'border-lamo-border bg-white text-lamo-dark hover:border-lamo-blue/40'
                  }`}
                >
                  <span className="text-base">{cat.icon}</span>
                  <div>
                    <div className="font-medium">{cat.name}</div>
                    <div className="text-xs text-lamo-gray-muted">{cat.questionCount} Qs</div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* AI Topic (when AI) */}
      {useAI && (
        <div>
          <label htmlFor="ai-topic" className="block text-sm font-medium text-lamo-dark mb-1.5">Topic</label>
          <input
            id="ai-topic"
            type="text"
            value={aiTopic}
            onChange={(e) => setAiTopic(e.target.value)}
            placeholder="e.g. Dinosaurs, Taylor Swift, US Presidents"
            maxLength={100}
            className="w-full px-4 py-2.5 border border-lamo-border rounded-xl text-lamo-dark placeholder:text-lamo-gray-muted focus:outline-none focus:ring-2 focus:ring-lamo-blue/40"
          />
          <p className="text-xs text-lamo-gray-muted mt-1.5">
            AI will generate {questionCount} unique questions about this topic
          </p>
        </div>
      )}

      {/* Question Count */}
      <div>
        <label className="block text-sm font-medium text-lamo-dark mb-1.5">
          Questions <span className="text-lamo-gray-muted font-normal">({questionCount})</span>
        </label>
        <input
          type="range"
          min={5}
          max={30}
          step={5}
          value={questionCount}
          onChange={(e) => setQuestionCount(Number(e.target.value))}
          className="w-full accent-lamo-blue"
        />
        <div className="flex justify-between text-xs text-lamo-gray-muted mt-1">
          <span>5</span>
          <span>30</span>
        </div>
      </div>

      {/* Time Per Question */}
      <div>
        <label className="block text-sm font-medium text-lamo-dark mb-1.5">
          Time per Question <span className="text-lamo-gray-muted font-normal">({timePerQuestion}s)</span>
        </label>
        <input
          type="range"
          min={1}
          max={60}
          step={1}
          value={timePerQuestion}
          onChange={(e) => setTimePerQuestion(Number(e.target.value))}
          className="w-full accent-lamo-blue"
        />
        <div className="flex justify-between text-xs text-lamo-gray-muted mt-1">
          <span>1s</span>
          <span>60s</span>
        </div>
      </div>

      {/* Players */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label htmlFor="min-players" className="block text-sm font-medium text-lamo-dark mb-1.5">Min Players</label>
          <select
            id="min-players"
            value={minPlayers}
            onChange={(e) => setMinPlayers(Number(e.target.value))}
            className="w-full px-3 py-2.5 border border-lamo-border rounded-xl text-lamo-dark bg-white focus:outline-none focus:ring-2 focus:ring-lamo-blue/40"
          >
            {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="max-players" className="block text-sm font-medium text-lamo-dark mb-1.5">Max Players</label>
          <select
            id="max-players"
            value={maxPlayers}
            onChange={(e) => setMaxPlayers(Number(e.target.value))}
            className="w-full px-3 py-2.5 border border-lamo-border rounded-xl text-lamo-dark bg-white focus:outline-none focus:ring-2 focus:ring-lamo-blue/40"
          >
            {[2, 3, 4, 5, 6, 7, 8, 10, 12].map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Scoring Method */}
      <div>
        <label className="block text-sm font-medium text-lamo-dark mb-1.5">Scoring</label>
        <div className="grid grid-cols-2 gap-2">
          {SCORING_METHODS.map((method) => (
            <button
              key={method.id}
              type="button"
              onClick={() => setScoringMethod(method.id as ScoringMethod)}
              className={`px-3 py-2.5 rounded-xl border text-left text-sm transition-colors ${
                scoringMethod === method.id
                  ? 'border-lamo-blue bg-lamo-blue/5 text-lamo-dark'
                  : 'border-lamo-border bg-white text-lamo-dark hover:border-lamo-blue/40'
              }`}
            >
              <div className="font-medium">{method.name}</div>
              <div className="text-xs text-lamo-gray-muted">{method.description}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Toggles */}
      <div className="space-y-3">
        <label className="flex items-center justify-between cursor-pointer">
          <div>
            <div className="text-sm font-medium text-lamo-dark">Streak Bonus</div>
            <div className="text-xs text-lamo-gray-muted">Multiplier for consecutive correct answers</div>
          </div>
          <input
            type="checkbox"
            checked={streakBonus}
            onChange={(e) => setStreakBonus(e.target.checked)}
            className="w-5 h-5 rounded accent-lamo-blue"
          />
        </label>

        <label className="flex items-center justify-between cursor-pointer">
          <div>
            <div className="text-sm font-medium text-lamo-dark">Show Answers</div>
            <div className="text-xs text-lamo-gray-muted">Reveal correct answer between questions</div>
          </div>
          <input
            type="checkbox"
            checked={showAnswers}
            onChange={(e) => setShowAnswers(e.target.checked)}
            className="w-5 h-5 rounded accent-lamo-blue"
          />
        </label>

        <label className="flex items-center justify-between cursor-pointer">
          <div>
            <div className="text-sm font-medium text-lamo-dark">Private Game</div>
            <div className="text-xs text-lamo-gray-muted">Hidden from lobby, join by code only</div>
          </div>
          <input
            type="checkbox"
            checked={isPrivate}
            onChange={(e) => setIsPrivate(e.target.checked)}
            className="w-5 h-5 rounded accent-lamo-blue"
          />
        </label>
      </div>

      {/* Time Between Questions (only when showAnswers is on) */}
      {showAnswers && (
        <div>
          <label className="block text-sm font-medium text-lamo-dark mb-1.5">
            Time Between Questions <span className="text-lamo-gray-muted font-normal">({timeBetweenQuestions}s)</span>
          </label>
          <input
            type="range"
            min={1}
            max={15}
            step={1}
            value={timeBetweenQuestions}
            onChange={(e) => setTimeBetweenQuestions(Number(e.target.value))}
            className="w-full accent-lamo-blue"
          />
          <div className="flex justify-between text-xs text-lamo-gray-muted mt-1">
            <span>1s</span>
            <span>15s</span>
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <p className="text-red-500 text-sm">{error}</p>
      )}

      {/* Buttons */}
      <div className="flex gap-3">
        <button
          type="submit"
          disabled={submitting}
          className="flex-1 px-6 py-3 bg-lamo-blue text-white font-semibold rounded-pill hover:bg-lamo-blue-dark transition-colors disabled:opacity-50"
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
