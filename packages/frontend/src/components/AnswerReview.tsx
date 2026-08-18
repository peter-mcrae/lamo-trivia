import type { Player, QuestionReview } from '@lamo-trivia/shared';

interface AnswerReviewProps {
  review: QuestionReview[];
  players: Player[];
  /** The viewing player, so their own picks can be called out. Null if unknown. */
  playerId: string | null;
}

export function AnswerReview({ review, players, playerId }: AnswerReviewProps) {
  if (review.length === 0) return null;

  const myCorrect = playerId
    ? review.filter((q) => q.answers[playerId] === q.correctIndex).length
    : null;

  return (
    <div>
      <div className="flex items-baseline justify-between mb-4">
        <h3 className="text-lg font-bold text-lamo-dark">Answer Review</h3>
        {myCorrect !== null && (
          <p className="text-sm text-lamo-gray-muted">
            You got <span className="font-semibold text-lamo-dark">{myCorrect}</span> of{' '}
            {review.length} right
          </p>
        )}
      </div>

      <div className="space-y-4">
        {review.map((item) => {
          const myAnswer = playerId != null ? item.answers[playerId] : undefined;
          const answered = myAnswer !== undefined;
          const gotItRight = myAnswer === item.correctIndex;
          const unanswered = players.filter((p) => item.answers[p.id] === undefined);

          return (
            <div
              key={`${item.questionIndex}-${item.question.id}`}
              className="p-5 rounded-2xl bg-white border border-lamo-border"
            >
              <div className="flex items-center justify-between gap-3 mb-2">
                <p className="text-xs font-semibold text-lamo-gray-muted uppercase tracking-wide">
                  Question {item.questionIndex + 1}
                </p>
                {playerId && (
                  <span
                    className={`text-xs font-semibold px-2.5 py-1 rounded-full ${
                      gotItRight
                        ? 'bg-green-50 text-green-700'
                        : answered
                          ? 'bg-red-50 text-red-600'
                          : 'bg-lamo-bg text-lamo-gray-muted'
                    }`}
                  >
                    {gotItRight ? 'You got it' : answered ? 'You missed it' : 'No answer'}
                  </span>
                )}
              </div>

              <p className="font-semibold text-lamo-dark mb-4">{item.question.text}</p>

              <div className="space-y-2">
                {item.question.options.map((option, i) => {
                  const isCorrect = i === item.correctIndex;
                  const pickedByMe = myAnswer === i;
                  const pickedBy = players.filter((p) => item.answers[p.id] === i);

                  const tone = isCorrect
                    ? 'bg-green-50 border-green-500'
                    : pickedByMe
                      ? 'bg-red-50 border-red-300'
                      : 'bg-lamo-bg-hero border-lamo-border';

                  return (
                    <div
                      key={i}
                      className={`flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 px-4 py-2.5 rounded-xl border ${tone}`}
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className={`text-sm break-words ${
                            isCorrect ? 'font-semibold text-green-700' : 'text-lamo-dark'
                          }`}
                        >
                          {option}
                        </span>
                        {isCorrect && (
                          <span className="text-green-600 text-sm" aria-label="Correct answer">
                            ✓
                          </span>
                        )}
                        {pickedByMe && !isCorrect && (
                          <span className="text-xs text-red-500 font-medium whitespace-nowrap">
                            your pick
                          </span>
                        )}
                      </div>

                      {pickedBy.length > 0 && (
                        <div className="flex flex-wrap items-center justify-end gap-1 ml-auto">
                          {pickedBy.map((p) => (
                            <span key={p.id} className="text-base" title={p.username}>
                              {p.avatar.emoji}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {unanswered.length > 0 && (
                <p className="mt-3 text-xs text-lamo-gray-muted">
                  No answer:{' '}
                  {unanswered.map((p) => `${p.avatar.emoji} ${p.username}`).join(', ')}
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
