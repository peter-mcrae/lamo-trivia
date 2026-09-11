import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { GameConfigInput } from "@lamo-trivia/shared";
import { GameConfigForm } from "@/components/GameConfigForm";
import { SEO } from "@/components/SEO";
import { useAuthContext } from "@/contexts/AuthContext";
import { api } from "@/lib/api";
import { BrandMark, Arrow } from "@/components/Brand";

export default function CreateGame() {
  const navigate = useNavigate();
  const { user } = useAuthContext();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [selectedGroupId, setSelectedGroupId] = useState("");
  const [groups, setGroups] = useState<{ groupId: string; name: string }[]>([]);

  useEffect(() => {
    if (!user) return;
    api
      .getMyGroups()
      .then(({ groups: owned }) => setGroups(owned))
      .catch(() => {});
  }, [user]);

  const handleSubmit = async (config: GameConfigInput) => {
    setSubmitting(true);
    setError("");
    try {
      const result = selectedGroupId
        ? await api.createGroupGame(selectedGroupId, config)
        : await api.createGame(config);
      navigate(`/game/${result.gameId}`);
    } catch {
      setError("Failed to create game. Try again.");
      setSubmitting(false);
    }
  };

  return (
    <>
      <SEO
        title="Create a Trivia Game - LAMO Trivia"
        description="Create a free multiplayer trivia game. Choose categories, set the rules, and share the code with friends and family."
        canonical="https://lamotrivia.app/create"
      />
      <div className="setup-layout site-width">
        <aside className="setup-intro">
          <Link to="/" className="text-link">
            ← All games
          </Link>
          <div className="setup-emblem">
            <BrandMark />
          </div>
          <p className="eyebrow">THE GAME-NIGHT CLASSIC</p>
          <h1>
            Your game.
            <br /> Your rules.
          </h1>
          <p>
            From movie buffs to space nerds. Make a trivia game that’s very,
            very you.
          </p>
          <div className="setup-facts">
            <span>Free to play</span>
            <span>1–12 players</span>
            <span>No account needed</span>
          </div>
          <Link to="/how-to-play" className="text-link">
            New here? Here’s how to play <Arrow diagonal />
          </Link>
        </aside>
        <section className="setup-form-panel" aria-labelledby="setup-heading">
          <div className="panel-heading">
            <span className="eyebrow">LET’S MAKE IT INTERESTING</span>
            <h2 id="setup-heading">Set up your trivia.</h2>
            <p>Pick a topic. We’ll bring the questions.</p>
          </div>

          {groups.length > 0 && (
            <div className="mb-6">
              <label
                htmlFor="game-group"
                className="block text-sm font-medium text-lamo-dark mb-1.5"
              >
                Create in
              </label>
              <select
                id="game-group"
                value={selectedGroupId}
                onChange={(e) => setSelectedGroupId(e.target.value)}
                className="w-full px-4 py-2.5 border border-lamo-border rounded-xl text-lamo-dark bg-white focus:outline-none focus:ring-2 focus:ring-lamo-blue/40"
              >
                <option value="">Public (anyone with the code can join)</option>
                {groups.map((g) => (
                  <option key={g.groupId} value={g.groupId}>
                    {g.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <GameConfigForm
            submitLabel="Create Game"
            submittingLabel="Creating..."
            onSubmit={handleSubmit}
            submitting={submitting}
            error={error}
          />
        </section>
      </div>
    </>
  );
}
