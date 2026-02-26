import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { GAME_DEFAULTS, SCORING_METHODS } from '@lamo-trivia/shared';
import type { TriviaCategory, ScoringMethod } from '@lamo-trivia/shared';
import { api } from '@/lib/api';

export default function CreateGame() {
  const navigate = useNavigate();
  const [categories, setCategories] = useState<TriviaCategory[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const [name, setName] = useState('');
  const [useAI, setUseAI] = useState(false);
  const [aiTopic, setAiTopic] = useState('');
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [questionCount, setQuestionCount] = useState(GAME_DEFAULTS.questionCount);
  const [timePerQuestion, setTimePerQuestion] = useState(GAME_DEFAULTS.timePerQuestion);
  const [minPlayers, setMinPlayers] = useState(GAME_DEFAULTS.minPlayers);
  const [maxPlayers, setMaxPlayers] = useState(GAME_DEFAULTS.maxPlayers);
  const [scoringMethod, setScoringMethod] = useState<ScoringMethod>(GAME_DEFAULTS.scoringMethod);
  const [streakBonus, setStreakBonus] = useState(GAME_DEFAULTS.streakBonus);
  const [showAnswers, setShowAnswers] = useState(GAME_DEFAULTS.showAnswers);
  const [timeBetweenQuestions, setTimeBetweenQuestions] = useState(GAME_DEFAULTS.timeBetweenQuestions);
  const [isPrivate, setIsPrivate] = useState(false);

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!name.trim()) {
      setError('Give your game a name');
      return;
    }

    if (useAI) {
      if (!aiTopic.trim()) {
        setError('Enter a topic for AI-generated questions');
        return;
      }
    } else {
      if (selectedCategories.length === 0) {
        setError('Select at least one category');
        return;
      }
      if (totalAvailable < questionCount) {
        setError(`Only ${totalAvailable} questions available in selected categories`);
        return;
      }
    }

    setSubmitting(true);
    try {
      const result = await api.createGame({
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
      navigate(`/game/${result.gameId}`);
    } catch {
      setError('Failed to create game. Try again.');
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-lg mx-auto py-10 px-6">
      <h2 className="text-2xl font-bold text-lamo-dark mb-6">Create Game</h2>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Game Name */}
        <div>
          <label className="block text-sm font-medium text-lamo-dark mb-1.5">Game Name</label>
          <input
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
            <label className="block text-sm font-medium text-lamo-dark mb-1.5">Topic</label>
            <input
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
            min={5}
            max={60}
            step={5}
            value={timePerQuestion}
            onChange={(e) => setTimePerQuestion(Number(e.target.value))}
            className="w-full accent-lamo-blue"
          />
          <div className="flex justify-between text-xs text-lamo-gray-muted mt-1">
            <span>5s</span>
            <span>60s</span>
          </div>
        </div>

        {/* Players */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-lamo-dark mb-1.5">Min Players</label>
            <select
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
            <label className="block text-sm font-medium text-lamo-dark mb-1.5">Max Players</label>
            <select
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
              min={3}
              max={15}
              step={1}
              value={timeBetweenQuestions}
              onChange={(e) => setTimeBetweenQuestions(Number(e.target.value))}
              className="w-full accent-lamo-blue"
            />
            <div className="flex justify-between text-xs text-lamo-gray-muted mt-1">
              <span>3s</span>
              <span>15s</span>
            </div>
          </div>
        )}

        {/* Error */}
        {error && (
          <p className="text-red-500 text-sm">{error}</p>
        )}

        {/* Submit */}
        <button
          type="submit"
          disabled={submitting}
          className="w-full px-6 py-3 bg-lamo-blue text-white font-semibold rounded-pill hover:bg-lamo-blue-dark transition-colors disabled:opacity-50"
        >
          {submitting ? 'Creating...' : 'Create Game'}
        </button>
      </form>
    </div>
  );
}
