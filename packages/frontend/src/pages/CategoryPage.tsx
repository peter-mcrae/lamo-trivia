import { useParams, Link } from 'react-router-dom';
import { TRIVIA_CATEGORIES } from '@lamo-trivia/shared';
import { SEO } from '@/components/SEO';

const categoryDescriptions: Record<string, { description: string; tips: string[] }> = {
  'harry-potter': {
    description: 'Test your knowledge of the Wizarding World! From Hogwarts houses to magical creatures, from spells to characters, challenge yourself with questions about J.K. Rowling\'s beloved series.',
    tips: [
      'Brush up on character names and their relationships',
      'Remember key spells and their effects',
      'Know your Hogwarts houses and their traits',
      'Study magical creatures and their characteristics'
    ]
  },
  'science': {
    description: 'Explore the wonders of science! Questions cover physics, chemistry, biology, astronomy, and more. Perfect for science enthusiasts and curious minds.',
    tips: [
      'Review basic scientific principles',
      'Know famous scientists and their discoveries',
      'Understand fundamental concepts in physics and chemistry',
      'Remember key facts about the natural world'
    ]
  },
  'history': {
    description: 'Journey through time with history trivia! From ancient civilizations to modern events, test your knowledge of world history, important dates, and historical figures.',
    tips: [
      'Focus on major historical events and dates',
      'Know important historical figures',
      'Understand cause and effect relationships',
      'Study different time periods and regions'
    ]
  },
  'sports': {
    description: 'For sports fans! Questions about athletes, teams, records, championships, and sports history. Whether you love football, basketball, or Olympic sports, this category has something for you.',
    tips: [
      'Know current and historical sports records',
      'Remember famous athletes and their achievements',
      'Study major championships and tournaments',
      'Learn about different sports and their rules'
    ]
  },
  'entertainment': {
    description: 'Lights, camera, action! Test your knowledge of movies, TV shows, music, celebrities, and pop culture. From classic films to current hits, this category covers it all.',
    tips: [
      'Watch popular movies and TV shows',
      'Follow current entertainment news',
      'Know famous actors, directors, and musicians',
      'Remember award winners and nominees'
    ]
  },
  'geography': {
    description: 'Explore the world! Questions about countries, capitals, landmarks, flags, and geographical features. Perfect for travelers and geography enthusiasts.',
    tips: [
      'Study world maps and country locations',
      'Memorize capital cities',
      'Know famous landmarks and their locations',
      'Learn about different continents and regions'
    ]
  },
  'math': {
    description: 'Sharpen your math skills! Focus on multiplication times tables and basic arithmetic. Great for students and anyone who wants to keep their math skills sharp.',
    tips: [
      'Practice multiplication tables regularly',
      'Work on mental math speed',
      'Review basic arithmetic operations',
      'Focus on accuracy and speed'
    ]
  },
  'diary-of-wimpy-kid': {
    description: 'For fans of Greg Heffley and his adventures! Test your knowledge of the Diary of a Wimpy Kid series, including characters, plot points, and memorable moments.',
    tips: [
      'Re-read your favorite books in the series',
      'Remember character names and relationships',
      'Know key plot points and storylines',
      'Pay attention to Greg\'s misadventures'
    ]
  },
  'general': {
    description: 'A bit of everything! General knowledge questions covering a wide range of topics. Perfect for well-rounded trivia enthusiasts who know a little about a lot.',
    tips: [
      'Stay curious and read widely',
      'Follow current events',
      'Learn about different cultures and topics',
      'Trust your general knowledge'
    ]
  }
};

export default function CategoryPage() {
  const { categoryId } = useParams<{ categoryId: string }>();
  const category = TRIVIA_CATEGORIES.find(cat => cat.id === categoryId);
  const categoryInfo = categoryId ? categoryDescriptions[categoryId] : null;

  if (!category || !categoryInfo) {
    return (
      <div className="max-w-4xl mx-auto px-6 py-16 text-center">
        <h1 className="text-4xl font-bold text-lamo-dark mb-4">Category Not Found</h1>
        <p className="text-lamo-gray mb-6">The category you're looking for doesn't exist.</p>
        <Link to="/" className="text-lamo-blue hover:underline">Return to Home</Link>
      </div>
    );
  }

  const pageTitle = `${category.name} Trivia - Free Online ${category.name} Quiz Games`;
  const pageDescription = `${categoryInfo.description} Play free ${category.name.toLowerCase()} trivia games with friends and family. ${category.questionCount}+ questions available!`;

  return (
    <>
      <SEO
        title={pageTitle}
        description={pageDescription}
        keywords={`${category.name.toLowerCase()} trivia, ${category.name.toLowerCase()} quiz, ${category.name.toLowerCase()} questions, free ${category.name.toLowerCase()} games`}
        canonical={`https://lamotrivia.app/trivia/${categoryId}`}
        ogTitle={pageTitle}
        ogDescription={categoryInfo.description}
      />
      <div className="max-w-4xl mx-auto px-6 py-16">
        <div className="text-center mb-12">
          <span className="text-6xl mb-4 block">{category.icon}</span>
          <h1 className="text-4xl font-bold text-lamo-dark mb-4">{category.name} Trivia</h1>
          <p className="text-xl text-lamo-gray max-w-2xl mx-auto">{categoryInfo.description}</p>
          <div className="mt-6">
            <span className="inline-block px-4 py-2 bg-lamo-bg rounded-full text-sm font-semibold text-lamo-dark">
              {category.questionCount}+ Questions Available
            </span>
          </div>
        </div>

        <div className="prose prose-lg max-w-none">
          <section className="mb-12">
            <h2 className="text-2xl font-bold text-lamo-dark mb-4">About {category.name} Trivia</h2>
            <p className="text-lamo-gray mb-6">
              Our {category.name.toLowerCase()} trivia category features {category.questionCount}+ carefully 
              crafted questions designed to challenge and entertain players of all skill levels. Whether 
              you're a beginner or an expert, you'll find questions that test your knowledge and keep you engaged.
            </p>
          </section>

          <section className="mb-12">
            <h2 className="text-2xl font-bold text-lamo-dark mb-4">Tips for Playing {category.name} Trivia</h2>
            <ul className="list-disc list-inside text-lamo-gray mb-6 space-y-2">
              {categoryInfo.tips.map((tip, index) => (
                <li key={index}>{tip}</li>
              ))}
            </ul>
          </section>

          <section className="mb-12 bg-lamo-bg p-8 rounded-2xl">
            <h2 className="text-2xl font-bold text-lamo-dark mb-4">Ready to Play?</h2>
            <p className="text-lamo-gray mb-6">
              Start a {category.name.toLowerCase()} trivia game now! Create a game, select the {category.name} 
              category, and invite your friends to join. No sign-up required—just fun trivia games!
            </p>
            <div className="flex gap-4 justify-center">
              <Link
                to="/create"
                className="inline-flex items-center px-6 py-3 bg-lamo-blue text-white font-semibold rounded-pill hover:bg-lamo-blue-dark transition-colors"
              >
                Create {category.name} Game
              </Link>
              <Link
                to="/lobby"
                className="inline-flex items-center px-6 py-3 border border-lamo-border text-lamo-dark font-semibold rounded-pill hover:bg-lamo-bg transition-colors"
              >
                Join a Game
              </Link>
            </div>
          </section>

          <section className="mb-12">
            <h2 className="text-2xl font-bold text-lamo-dark mb-4">Explore Other Categories</h2>
            <p className="text-lamo-gray mb-4">
              Love trivia? Check out our other categories:
            </p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {TRIVIA_CATEGORIES.filter(cat => cat.id !== categoryId).slice(0, 6).map((cat) => (
                <Link
                  key={cat.id}
                  to={`/trivia/${cat.id}`}
                  className="flex flex-col items-center gap-2 p-4 rounded-2xl bg-lamo-bg border border-lamo-border hover:scale-105 hover:shadow-md transition-all"
                >
                  <span className="text-3xl">{cat.icon}</span>
                  <span className="text-sm font-semibold text-lamo-dark">{cat.name}</span>
                </Link>
              ))}
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
