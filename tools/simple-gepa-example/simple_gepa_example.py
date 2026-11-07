import random
from typing import Any, Literal, TypedDict
import os

import dspy
from phoenix.otel import register
from openinference.instrumentation import using_attributes
from dspy.teleprompt.gepa.gepa_utils import ScoreWithFeedback


TOTAL_EXAMPLES = 100
# The number of examples to use in the process
JUDGE_KIND: Literal['llm', 'rules'] = 'llm'
# How to judge correctness and generate feedback: via LLM or rules
LM_KIND: Literal['bedrock', 'ollama'] = 'ollama'
# if using bedrock, ensure AWS credentials are configured in your environment


def create_lm(kind: Literal['bedrock', 'ollama']) -> dspy.LM:
    if kind == 'bedrock':
        return dspy.LM(
            'bedrock/us.anthropic.claude-sonnet-4-20250514-v1:0',
            temperature=0.5,
            max_tokens=64000,
            num_retries=0,
            aws_region_name='us-east-1',
        )
    elif kind == 'ollama':
        return dspy.LM(
            # Best: qwen3:4b-instruct-2507-fp16
            # Best balance: qwen3:4b-instruct-2507-q4_K_M
            # Good, but slow: qwen3:8b
            'ollama/qwen3:8b',
            api_base='http://localhost:11434',
        )
    else:
        raise ValueError(f'Unknown LM kind: {kind}')


# Bad signature with no instructions, poorly named fields, and no descriptions
class SimpleClassifier(dspy.Signature):
    input: str = dspy.InputField()
    output: str = dspy.OutputField()


# fmt: off
def create_simple_examples(count: int):
    examples = [
        # Positive examples
        dspy.Example(input='I absolutely love this amazing product!', output='positive').with_inputs('input'),
        dspy.Example(input="I'm thrilled and excited about this!", output='positive').with_inputs('input'),
        dspy.Example(input='What a fantastic and wonderful day!', output='positive').with_inputs('input'),
        dspy.Example(input='This is excellent work, well done!', output='positive').with_inputs('input'),
        dspy.Example(input="I'm so happy with these results", output='positive').with_inputs('input'),
        dspy.Example(input='Outstanding performance, truly impressive', output='positive').with_inputs('input'),
        dspy.Example(input='This brings me great joy and satisfaction', output='positive').with_inputs('input'),
        dspy.Example(input='Perfect! Exactly what I was hoping for', output='positive').with_inputs('input'),
        dspy.Example(input="I'm delighted by this wonderful surprise", output='positive').with_inputs('input'),
        dspy.Example(input='Brilliant work, absolutely brilliant!', output='positive').with_inputs('input'),
        # Negative examples
        dspy.Example(input="This is the worst thing I've ever seen", output='negative').with_inputs('input'),
        dspy.Example(input='I hate everything about this terrible experience', output='negative').with_inputs('input'),
        dspy.Example(input='This is disappointing and frustrating', output='negative').with_inputs('input'),
        dspy.Example(input='Awful quality, completely unacceptable', output='negative').with_inputs('input'),
        dspy.Example(input="I'm disgusted by this poor service", output='negative').with_inputs('input'),
        dspy.Example(input='This makes me angry and upset', output='negative').with_inputs('input'),
        dspy.Example(input='Horrible experience, waste of time', output='negative').with_inputs('input'),
        dspy.Example(input='I regret this decision completely', output='negative').with_inputs('input'),
        dspy.Example(input='Pathetic performance, very disappointing', output='negative').with_inputs('input'),
        dspy.Example(input='This is a disaster and failure', output='negative').with_inputs('input'),
        # Neutral examples
        dspy.Example(input='The meeting is scheduled for Tuesday', output='neutral').with_inputs('input'),
        dspy.Example(input='The document contains three sections', output='neutral').with_inputs('input'),
        dspy.Example(input='The temperature is 72 degrees', output='neutral').with_inputs('input'),
        dspy.Example(input='Please submit your report by Friday', output='neutral').with_inputs('input'),
        dspy.Example(input='The office is located on Main Street', output='neutral').with_inputs('input'),
        dspy.Example(input='Training session starts at 9 AM', output='neutral').with_inputs('input'),
        dspy.Example(input='The file has been uploaded successfully', output='neutral').with_inputs('input'),
        dspy.Example(input='Current status: under review', output='neutral').with_inputs('input'),
        dspy.Example(input='Reference number: 12345', output='neutral').with_inputs('input'),
        dspy.Example(input='The system will be updated tonight', output='neutral').with_inputs('input'),
        # Difficult examples
        dspy.Example(input='I love waiting in long lines', output='negative').with_inputs('input'),
        dspy.Example(input='This is the best way to ruin a day', output='positive').with_inputs('input'),
    ]
    random.shuffle(examples)
    return examples[:count]
# fmt: on

class DifficultyTrackingData(TypedDict):
    scores: list[float]
    expected_output: str

difficulty_tracking: dict[str, DifficultyTrackingData] = {}


def metric(
    gold: dspy.Example,
    pred: dspy.Prediction,
    trace: list[tuple[Any, dict[str, Any], dspy.Prediction]] | None = None,
    pred_name: str | None = None,
    pred_trace: list[tuple[Any, dict[str, Any], dspy.Prediction]] | None = None,
) -> float | ScoreWithFeedback:
    global difficulty_tracking

    correct = gold.output == pred.output
    score = 1.0 if correct else 0.0

    example_text = gold.input
    if example_text not in difficulty_tracking:
        difficulty_tracking[example_text] = DifficultyTrackingData(
            scores=[],
            expected_output=gold.output,
        )

    difficulty_tracking[example_text]['scores'].append(score)

    return ScoreWithFeedback(
        score=score, feedback='Correct!' if correct else generate_feedback(gold, pred)
    )


# region: Feedback Generation


def generate_feedback(gold: dspy.Example, pred: dspy.Prediction):
    feedback = f"Wrong! Your output should have been: '{gold.output}'\n\n"

    if JUDGE_KIND == 'llm':
        return feedback + _generate_feedback_via_llm(gold, pred)
    else:
        return feedback + _generate_feedback_via_rules(gold, pred)


def _generate_feedback_via_rules(gold: dspy.Example, pred: dspy.Prediction):
    POSITIVE_WORDS = [
        'love',
        'amazing',
        'fantastic',
        'wonderful',
        'thrilled',
        'excited',
    ]
    NEGATIVE_WORDS = ['hate', 'worst', 'terrible', 'disappointing', 'frustrating']

    feedback = 'Because:\n'
    if gold.output == 'positive':
        found_positive_words = [
            word for word in POSITIVE_WORDS if word in gold.input.lower()
        ]
        if found_positive_words:
            feedback += (
                f'This contains positive words like: {", ".join(found_positive_words)}.'
            )
        else:
            feedback += 'This expresses happiness/satisfaction.'
    elif gold.output == 'negative':
        found_negative_words = [
            word for word in NEGATIVE_WORDS if word in gold.input.lower()
        ]
        if found_negative_words:
            feedback += (
                f'This contains negative words like: {", ".join(found_negative_words)}.'
            )
        else:
            feedback += 'This expresses unhappiness/dissatisfaction.'
    else:
        feedback += 'This is factual information without emotional content.'
    return feedback


def _generate_feedback_via_llm(gold: dspy.Example, pred: dspy.Prediction):
    class Feedback(dspy.Signature):
        input: str = dspy.InputField(desc='The input text given to the LLM')
        output: str = dspy.InputField(desc='The incorrect output generated by the LLM')
        expected_output: str = dspy.InputField(
            desc='The correct and expected output text'
        )

        why_your_output_was_wrong: str = dspy.OutputField(
            desc='Explanation of why the output was wrong'
        )
        what_you_should_have_done_instead: str = dspy.OutputField(
            desc='Correct approach or reasoning that should have been used to arrive at the expected output'
        )

    fb = dspy.Predict(Feedback)(
        input=gold.input, output=pred.output, expected_output=gold.output
    )
    return f'Why wrong: {fb.why_your_output_was_wrong}\nCorrect approach: {fb.what_you_should_have_done_instead}'


# endregion: Feedback Generation

# region: Behind-the-scenes analysis and reporting

class DifficultyData(TypedDict):
    text: str
    expected_output: str
    avg_score: float
    scores: list[float]

def analyze_difficulty():
    difficulty_analysis: list[DifficultyData] = []

    for text, data in difficulty_tracking.items():
        difficulty_analysis.append(DifficultyData(
            text=text,
            expected_output=data['expected_output'],
            avg_score=sum(data['scores']) / len(data['scores']),
            scores=data['scores'],
        ))

    return sorted(difficulty_analysis, key=lambda x: x['avg_score'], reverse=True)


def get_letter_grade(score_percentage):
    percentage = score_percentage * 100

    if percentage >= 97:
        return 'A+', '🏆'
    elif percentage >= 93:
        return 'A', '🥇'
    elif percentage >= 90:
        return 'A-', '🟢'
    elif percentage >= 87:
        return 'B+', '🟡'
    elif percentage >= 83:
        return 'B', '🟡'
    elif percentage >= 80:
        return 'B-', '🟡'
    elif percentage >= 77:
        return 'C+', '🟠'
    elif percentage >= 73:
        return 'C', '🟠'
    elif percentage >= 70:
        return 'C-', '🟠'
    elif percentage >= 67:
        return 'D+', '🔴'
    elif percentage >= 63:
        return 'D', '🔴'
    elif percentage >= 60:
        return 'D-', '🔴'
    else:
        return 'F', '💀'


def print_difficulty_analysis():
    global difficulty_tracking

    analysis = analyze_difficulty()

    print('\n🎯 Example Difficulty Analysis')
    print('=' * 50)
    print(
        'Ranked from EASIEST to HARDEST based on metric scores during GEPA optimization:'
    )
    print(
        f'(Tracked across {sum(len(data["scores"]) for data in difficulty_tracking.values())} total feedback calls)'
    )
    print()

    for i, item in enumerate(analysis, 1):
        letter_grade, emoji = get_letter_grade(item['avg_score'])

        print(f'{i:2d}. {emoji} {letter_grade} {item["avg_score"] * 100:.1f}%')
        print(
            f'    Text: "{item["text"][:60]}{"..." if len(item["text"]) > 60 else ""}"'
        )
        print(f'    Expected: {item["expected_output"]}')
        print(f'    Calls: {len(item["scores"])}')
        print()

    # Summary stats by letter grade
    grade_counts = {}
    for item in analysis:
        letter_grade, _ = get_letter_grade(item['avg_score'])
        grade_counts[letter_grade] = grade_counts.get(letter_grade, 0) + 1

    # Display grade distribution
    grade_summary = []
    for grade in [
        'A+',
        'A',
        'A-',
        'B+',
        'B',
        'B-',
        'C+',
        'C',
        'C-',
        'D+',
        'D',
        'D-',
        'F',
    ]:
        if grade in grade_counts:
            grade_summary.append(f'{grade_counts[grade]} {grade}')

    print(f'📊 Grade Distribution: {", ".join(grade_summary)}')

    easiest = analysis[0]
    hardest = analysis[-1]
    easiest_grade, easiest_emoji = get_letter_grade(easiest['avg_score'])
    hardest_grade, hardest_emoji = get_letter_grade(hardest['avg_score'])
    print(
        f'💡 Best: "{easiest["text"][:40]}..." ({easiest_emoji} {easiest_grade}: {easiest["avg_score"]:.2f})'
    )
    print(
        f'💀 Worst: "{hardest["text"][:40]}..." ({hardest_emoji} {hardest_grade}: {hardest["avg_score"]:.2f})'
    )


def test_program(program, examples: list[dspy.Example], session_id, test_type: str, description: str):
    print(description)

    failures = 0

    for i, test_example in enumerate(examples):
        try:
            with using_attributes(
                session_id=str(session_id), tags=['test', f'{test_type}_test']
            ):
                result = program(input=test_example.input)
            correct = test_example.output == result.output
            if not correct:
                failures += 1

            print(f'Test {i}:')
            print(f"  Text: '{test_example.input}'")
            print(f'  Expected: {test_example.output}')
            print(f'  Got: {result.output}')
            print(f'  Result: {"✅ Correct" if correct else "❌ Wrong"}')
            print()
        except Exception as e:
            print(f'Test {i} failed with error: {e}')
            failures += 1

    accuracy = (len(examples) - failures) / len(examples)
    print(f'Accuracy: {accuracy:.1%} ({len(examples) - failures}/{len(examples)})')

    return accuracy, failures


# endregion: Behind-the-scenes analysis and reporting


def main():
    examples = create_simple_examples(TOTAL_EXAMPLES)

    print(f'📊 Configuration: Using {len(examples)} total examples')

    os.environ['PHOENIX_COLLECTOR_ENDPOINT'] = 'http://localhost:6006/v1/traces'

    register(
        auto_instrument=True,
        endpoint='http://localhost:6006/v1/traces',
        project_name='GEPA-Learning-Example',
    )
    print('🔍 Phoenix instrumentation enabled for localhost:6006')


    lm = create_lm(LM_KIND)
    dspy.configure(lm=lm)

    program = dspy.Predict(SimpleClassifier)

    session_id = random.randint(100000, 999999)
    initial_accuracy, initial_failures = test_program(
        program,
        examples,
        session_id,
        'initial',
        '📊 Testing initial (poorly instructed) program...\nExpected failures due to vague instructions:\n',
    )

    optimizer = dspy.GEPA(metric=metric, auto='light', num_threads=1, reflection_lm=lm)


    with using_attributes(session_id=str(session_id), tags=['optimize']):
        optimized_program = optimizer.compile(program, trainset=examples)

    final_accuracy, final_failures = test_program(
        optimized_program,
        examples,
        session_id,
        'final',
        '✨ Testing optimized program...\nAfter learning from feedback:\n',
    )

    print(f'Improvement: {final_accuracy - initial_accuracy:+.1%}')

    print_difficulty_analysis()

    print(f"Optimized instructions: '{optimized_program.signature.instructions}'")


if __name__ == '__main__':
    main()
