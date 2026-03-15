import { Link } from 'react-router-dom';
import { SEO } from '@/components/SEO';

export default function HowToScavengerHunt() {
  return (
    <>
      <SEO
        title="How to Play Scavenger Hunts - LAMO Games Guide"
        description="Learn how to create and play AI-powered photo scavenger hunts. Step-by-step guide covering setup, item design, scoring, and best practices for amazing hunts."
        keywords="scavenger hunt, photo scavenger hunt, AI scavenger hunt, how to play scavenger hunt, scavenger hunt tips"
        canonical="https://lamotrivia.app/how-to-hunt"
        ogTitle="How to Play Scavenger Hunts - LAMO Games Guide"
        ogDescription="Everything you need to know to create and play amazing AI-powered photo scavenger hunts."
      />
      <div className="max-w-4xl mx-auto px-6 py-16">
        <h1 className="text-4xl font-bold text-lamo-dark mb-6">How to Play Scavenger Hunts</h1>

        <div className="prose prose-lg max-w-none">
          <p className="text-lg text-lamo-gray mb-8">
            LAMO Scavenger Hunts let you create real-world photo challenges for your group.
            Players race to find items, snap photos, and AI verifies them instantly. Here's everything you need to know.
          </p>

          {/* Overview */}
          <section className="mb-12">
            <h2 className="text-2xl font-bold text-lamo-dark mt-8 mb-4">How It Works</h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
              <div className="bg-lamo-bg p-5 rounded-2xl border border-lamo-border text-center">
                <span className="text-3xl block mb-2">📝</span>
                <h3 className="font-semibold text-lamo-dark mb-1">1. Create</h3>
                <p className="text-sm text-lamo-gray-muted">Design your hunt with items for players to find and photograph</p>
              </div>
              <div className="bg-lamo-bg p-5 rounded-2xl border border-lamo-border text-center">
                <span className="text-3xl block mb-2">📸</span>
                <h3 className="font-semibold text-lamo-dark mb-1">2. Hunt</h3>
                <p className="text-sm text-lamo-gray-muted">Players explore and snap photos of each item they find</p>
              </div>
              <div className="bg-lamo-bg p-5 rounded-2xl border border-lamo-border text-center">
                <span className="text-3xl block mb-2">🤖</span>
                <h3 className="font-semibold text-lamo-dark mb-1">3. Verify</h3>
                <p className="text-sm text-lamo-gray-muted">AI instantly checks each photo and awards points</p>
              </div>
            </div>
          </section>

          {/* Getting Started */}
          <section className="mb-12">
            <h2 className="text-2xl font-bold text-lamo-dark mt-8 mb-4">Getting Started</h2>
            <ol className="list-decimal list-inside text-lamo-gray mb-6 space-y-3">
              <li>
                <strong>Create or join a private group</strong> — scavenger hunts are played within groups so your friends and family can join easily
              </li>
              <li>
                <strong>Start a scavenger hunt</strong> from your group page — you'll need to be signed in and have credits
              </li>
              <li>
                <strong>Design your items</strong> — add the things players need to find and photograph (more on this below)
              </li>
              <li>
                <strong>Set the time limit</strong> — anywhere from 5 to 60 minutes
              </li>
              <li>
                <strong>Share with your group</strong> — everyone in the group can join the hunt
              </li>
            </ol>
          </section>

          {/* Credits */}
          <section className="mb-12">
            <h2 className="text-2xl font-bold text-lamo-dark mt-8 mb-4">Credits & Cost</h2>
            <div className="bg-orange-50 border border-orange-200 rounded-2xl p-6 mb-4">
              <p className="text-lamo-gray mb-3">
                Scavenger hunts use credits for AI photo verification. <strong className="text-lamo-dark">Only the hunt creator needs credits</strong> — players join for free.
              </p>
              <p className="text-lamo-gray mb-3">
                Each photo verification uses 1 credit. The estimated cost depends on:
              </p>
              <ul className="list-disc list-inside text-lamo-gray space-y-1">
                <li>Number of items in your hunt</li>
                <li>Max retries per item (if a photo is rejected, players can try again)</li>
                <li>Number of teams playing</li>
              </ul>
              <p className="text-sm text-lamo-gray-muted mt-3">
                Example: 8 items, 3 retries, 4 teams = up to 96 credits (worst case if every team uses all retries on every item).
                In practice, it's usually much less.
              </p>
            </div>
          </section>

          {/* Designing Items */}
          <section className="mb-12">
            <h2 className="text-2xl font-bold text-lamo-dark mt-8 mb-4">Designing Great Items</h2>
            <p className="text-lamo-gray mb-4">
              The items you choose make or break your hunt. Remember: an AI vision model will look at each photo and
              decide if it matches the description. Keep these principles in mind:
            </p>

            <div className="bg-green-50 border border-green-200 rounded-2xl p-6 mb-4">
              <h3 className="text-lg font-semibold text-green-800 mb-3">Good Item Descriptions</h3>
              <ul className="text-lamo-gray space-y-2">
                <li className="flex gap-2">
                  <span className="text-green-600 shrink-0">✓</span>
                  <span><strong>"A red fire hydrant"</strong> — specific, visually distinct, easy for AI to verify</span>
                </li>
                <li className="flex gap-2">
                  <span className="text-green-600 shrink-0">✓</span>
                  <span><strong>"A dog wearing a bandana or accessory"</strong> — clear criteria the AI can check</span>
                </li>
                <li className="flex gap-2">
                  <span className="text-green-600 shrink-0">✓</span>
                  <span><strong>"A street sign with a tree name"</strong> — specific enough to verify, fun to search for</span>
                </li>
                <li className="flex gap-2">
                  <span className="text-green-600 shrink-0">✓</span>
                  <span><strong>"A blue car parked next to a red car"</strong> — requires finding a specific combination</span>
                </li>
              </ul>
            </div>

            <div className="bg-red-50 border border-red-200 rounded-2xl p-6 mb-4">
              <h3 className="text-lg font-semibold text-red-800 mb-3">Items to Avoid</h3>
              <ul className="text-lamo-gray space-y-2">
                <li className="flex gap-2">
                  <span className="text-red-500 shrink-0">✗</span>
                  <span><strong>"Something interesting"</strong> — too vague, AI can't verify this</span>
                </li>
                <li className="flex gap-2">
                  <span className="text-red-500 shrink-0">✗</span>
                  <span><strong>"A feeling of joy"</strong> — not a physical, photographable thing</span>
                </li>
                <li className="flex gap-2">
                  <span className="text-red-500 shrink-0">✗</span>
                  <span><strong>"The oldest tree in the park"</strong> — AI can't determine age from a photo</span>
                </li>
                <li className="flex gap-2">
                  <span className="text-red-500 shrink-0">✗</span>
                  <span><strong>"A specific brand logo"</strong> — can be tricky for AI to identify brand names reliably</span>
                </li>
              </ul>
            </div>
          </section>

          {/* Using AI to Generate Items */}
          <section className="mb-12">
            <h2 className="text-2xl font-bold text-lamo-dark mt-8 mb-4">Using AI to Generate Items</h2>
            <p className="text-lamo-gray mb-4">
              Don't want to think up items yourself? When creating a hunt, you can:
            </p>
            <ol className="list-decimal list-inside text-lamo-gray space-y-3 mb-4">
              <li>
                <strong>Click "Copy AI Prompt"</strong> — this copies a pre-built prompt to your clipboard
              </li>
              <li>
                <strong>Paste it into ChatGPT, Claude, or any AI</strong> — it will generate a list of items with descriptions and optional clues
              </li>
              <li>
                <strong>Click "Paste JSON"</strong> back in the hunt creator and paste the AI's response
              </li>
            </ol>
            <p className="text-lamo-gray">
              The AI will generate items appropriate for your hunt. You can then edit, remove, or add to the list before starting.
            </p>
          </section>

          {/* Clues & Hints */}
          <section className="mb-12">
            <h2 className="text-2xl font-bold text-lamo-dark mt-8 mb-4">Clues & Hints</h2>
            <p className="text-lamo-gray mb-4">
              Each item can have up to 3 clues. Players can reveal clues during the hunt if they're stuck,
              but each clue costs points — so there's a trade-off.
            </p>
            <div className="bg-lamo-bg p-6 rounded-2xl mb-4">
              <h3 className="text-lg font-semibold text-lamo-dark mb-2">How Clues Work</h3>
              <ul className="list-disc list-inside text-lamo-gray space-y-1">
                <li>Each clue has a point cost (e.g., 200 points deducted from that item's score)</li>
                <li>Players choose when to reveal clues — it's optional</li>
                <li>More helpful clues should cost more points</li>
                <li>Items with no clues are fine — they're just harder</li>
              </ul>
            </div>
          </section>

          {/* Scoring */}
          <section className="mb-12">
            <h2 className="text-2xl font-bold text-lamo-dark mt-8 mb-4">Scoring</h2>
            <div className="bg-lamo-bg p-6 rounded-2xl mb-4">
              <ul className="list-disc list-inside text-lamo-gray space-y-2">
                <li><strong>Base points per item</strong> — the maximum points a player can earn for finding an item (default: 1,000)</li>
                <li><strong>Clue deductions</strong> — points are subtracted for each clue revealed</li>
                <li><strong>Retries</strong> — if a photo is rejected, players can try again (up to the max retries you set)</li>
                <li><strong>Final score</strong> — total points across all items found</li>
              </ul>
            </div>
          </section>

          {/* Host Dashboard */}
          <section className="mb-12">
            <h2 className="text-2xl font-bold text-lamo-dark mt-8 mb-4">The Host Dashboard</h2>
            <p className="text-lamo-gray mb-4">
              As the hunt host, you have a real-time command center to manage the entire hunt while it's running.
            </p>

            <div className="space-y-4">
              <div className="bg-indigo-50 border border-indigo-200 p-5 rounded-2xl">
                <h3 className="font-semibold text-lamo-dark mb-2">📊 Live Leaderboard & Progress</h3>
                <p className="text-sm text-lamo-gray">
                  See every team's score, which items they've found, and which they're still searching for — all updating in real time.
                  Watch the leaderboard shift as teams submit photos and rack up points.
                </p>
              </div>

              <div className="bg-indigo-50 border border-indigo-200 p-5 rounded-2xl">
                <h3 className="font-semibold text-lamo-dark mb-2">💬 Message Teams</h3>
                <p className="text-sm text-lamo-gray">
                  Send messages to all teams during the hunt. Use this to give encouragement, drop bonus hints,
                  announce time warnings, or add extra challenges on the fly.
                </p>
              </div>

              <div className="bg-indigo-50 border border-indigo-200 p-5 rounded-2xl">
                <h3 className="font-semibold text-lamo-dark mb-2">⚖️ Review AI Appeals</h3>
                <p className="text-sm text-lamo-gray">
                  Sometimes the AI gets it wrong — a photo clearly shows the right item but gets rejected.
                  When a player contests an AI decision, you'll see the appeal with their photo and can
                  override the verdict and award the points. This keeps the game fair and fun.
                </p>
              </div>

              <div className="bg-indigo-50 border border-indigo-200 p-5 rounded-2xl">
                <h3 className="font-semibold text-lamo-dark mb-2">🎮 Play & Host at the Same Time</h3>
                <p className="text-sm text-lamo-gray">
                  You can choose to join as a player while still having access to the host dashboard.
                  Toggle between hunting for items yourself and checking in on everyone's progress.
                </p>
              </div>
            </div>
          </section>

          {/* Best Practices */}
          <section className="mb-12">
            <h2 className="text-2xl font-bold text-lamo-dark mt-8 mb-4">Best Practices</h2>

            <div className="space-y-4">
              <div className="bg-lamo-bg p-5 rounded-2xl border border-lamo-border">
                <h3 className="font-semibold text-lamo-dark mb-2">Start Small</h3>
                <p className="text-sm text-lamo-gray">
                  For your first hunt, try 5–8 items with a 20–30 minute time limit.
                  You can always go bigger once your group gets the hang of it.
                </p>
              </div>

              <div className="bg-lamo-bg p-5 rounded-2xl border border-lamo-border">
                <h3 className="font-semibold text-lamo-dark mb-2">Match Items to Your Location</h3>
                <p className="text-sm text-lamo-gray">
                  Think about where your players will be. A neighborhood hunt is different from a park hunt or an indoor hunt.
                  Make sure the items are actually findable in that area.
                </p>
              </div>

              <div className="bg-lamo-bg p-5 rounded-2xl border border-lamo-border">
                <h3 className="font-semibold text-lamo-dark mb-2">Mix Easy and Hard</h3>
                <p className="text-sm text-lamo-gray">
                  Include a few easy items everyone can find quickly (keeps energy up) and a few challenging ones
                  for competitive players. The easy ones get people moving; the hard ones create excitement.
                </p>
              </div>

              <div className="bg-lamo-bg p-5 rounded-2xl border border-lamo-border">
                <h3 className="font-semibold text-lamo-dark mb-2">Write for the AI</h3>
                <p className="text-sm text-lamo-gray">
                  Remember that an AI model is verifying photos. Describe items by what they <em>look like</em>,
                  not what they <em>mean</em>. "A yellow flower" works great. "A flower that symbolizes friendship" doesn't.
                </p>
              </div>

              <div className="bg-lamo-bg p-5 rounded-2xl border border-lamo-border">
                <h3 className="font-semibold text-lamo-dark mb-2">Use Clues Strategically</h3>
                <p className="text-sm text-lamo-gray">
                  Add clues to your harder items so players don't get stuck and frustrated.
                  A good clue narrows down the search area without giving it away completely.
                </p>
              </div>

              <div className="bg-lamo-bg p-5 rounded-2xl border border-lamo-border">
                <h3 className="font-semibold text-lamo-dark mb-2">Set Enough Retries</h3>
                <p className="text-sm text-lamo-gray">
                  AI verification is good but not perfect. Allow at least 2–3 retries so players
                  aren't penalized by a slightly tricky photo angle. It's more fun when players can try again.
                </p>
              </div>

              <div className="bg-lamo-bg p-5 rounded-2xl border border-lamo-border">
                <h3 className="font-semibold text-lamo-dark mb-2">Give Enough Time</h3>
                <p className="text-sm text-lamo-gray">
                  It takes longer than you think to find and photograph items. A good rule of thumb:
                  2–3 minutes per item, plus travel time. For a 10-item outdoor hunt, 30 minutes is a good starting point.
                </p>
              </div>

            </div>
          </section>

          {/* Theme Ideas */}
          <section className="mb-12">
            <h2 className="text-2xl font-bold text-lamo-dark mt-8 mb-4">Hunt Theme Ideas</h2>
            <p className="text-lamo-gray mb-4">
              Need inspiration? Here are some hunt themes that work well:
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="bg-lamo-bg p-4 rounded-xl border border-lamo-border">
                <h3 className="font-semibold text-lamo-dark text-sm">🏡 Neighborhood Walk</h3>
                <p className="text-xs text-lamo-gray-muted mt-1">Fire hydrants, mailboxes, garden gnomes, specific colored houses</p>
              </div>
              <div className="bg-lamo-bg p-4 rounded-xl border border-lamo-border">
                <h3 className="font-semibold text-lamo-dark text-sm">🌿 Nature Hunt</h3>
                <p className="text-xs text-lamo-gray-muted mt-1">Types of flowers, leaves, birds, insects, tree bark patterns</p>
              </div>
              <div className="bg-lamo-bg p-4 rounded-xl border border-lamo-border">
                <h3 className="font-semibold text-lamo-dark text-sm">🏢 Indoor Office/School</h3>
                <p className="text-xs text-lamo-gray-muted mt-1">Specific objects, signs, colors, patterns found around a building</p>
              </div>
              <div className="bg-lamo-bg p-4 rounded-xl border border-lamo-border">
                <h3 className="font-semibold text-lamo-dark text-sm">🎉 Party / Event</h3>
                <p className="text-xs text-lamo-gray-muted mt-1">Decorations, food items, people doing specific things, themed objects</p>
              </div>
              <div className="bg-lamo-bg p-4 rounded-xl border border-lamo-border">
                <h3 className="font-semibold text-lamo-dark text-sm">🛒 Grocery Store</h3>
                <p className="text-xs text-lamo-gray-muted mt-1">Unusual fruits, specific brands, colorful displays, store sections</p>
              </div>
              <div className="bg-lamo-bg p-4 rounded-xl border border-lamo-border">
                <h3 className="font-semibold text-lamo-dark text-sm">🏖️ Beach / Park</h3>
                <p className="text-xs text-lamo-gray-muted mt-1">Shells, sandcastles, playground equipment, wildlife, sports equipment</p>
              </div>
            </div>
          </section>

          {/* CTA */}
          <div className="mt-12 pt-8 border-t border-lamo-border text-center">
            <p className="text-lamo-gray mb-4">Ready to create your first scavenger hunt?</p>
            <div className="flex gap-4 justify-center flex-wrap">
              <Link
                to="/hunt/create"
                className="inline-flex items-center px-6 py-3 bg-lamo-blue text-white font-semibold rounded-pill hover:bg-lamo-blue-dark transition-colors"
              >
                Create a Scavenger Hunt
              </Link>
              <Link
                to="/how-to-play"
                className="inline-flex items-center px-6 py-3 border border-lamo-border text-lamo-dark font-semibold rounded-pill hover:bg-lamo-bg transition-colors"
              >
                Trivia Guide
              </Link>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
