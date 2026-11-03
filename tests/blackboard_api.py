"""Run existing regressions, then exercise persistent teacher-only blackboards."""
import files_api  # Runs classroom and file API regressions first.
from classroom_api import call, key
from concurrent.futures import ThreadPoolExecutor

teacher, student, outsider = key(), key(), key()
room = call(teacher, 'create', name='黑板老师')
code = room['code']
assert room['blackboard'] == {'markdown': '', 'version': 0, 'updatedAt': None}
call(student, 'join', code=code, name='黑板学生')
call(student, 'blackboard-publish', code=code, markdown='forged', boardVersion=0, expected=403)
call(outsider, 'blackboard-publish', code=code, markdown='forged', boardVersion=0, expected=403)
for bad in [None, 42, {}, 'x' * 10001]:
    call(teacher, 'blackboard-publish', code=code, markdown=bad, boardVersion=0, expected=400)
markdown = '# 今日任务\n\n- **先思考**\n\n```python\nprint(42)\n```\n\n| A | B |\n| - | - |\n| 1 | 2 |'
published = call(teacher, 'blackboard-publish', code=code, markdown=markdown, boardVersion=0)['blackboard']
assert published['version'] == 1 and published['updatedAt']
assert call(student, code=code)['blackboard'] == published
call(teacher, 'heartbeat', code=code)
call(teacher, 'start', code=code, round=0)
assert call(student, code=code)['blackboard'] == published
call(teacher, 'blackboard-publish', code=code, markdown='stale', boardVersion=0, expected=409)
assert call(student, code=code)['blackboard'] == published
late = key()
assert call(late, 'join', code=code, name='后来同学')['blackboard'] == published
other = call(outsider, 'create', name='另一课堂')
assert other['blackboard']['markdown'] == ''
# Two tabs publishing the same base version must never silently overwrite each other.
def publish(text):
    try:
        return call(teacher, 'blackboard-publish', code=code, markdown=text, boardVersion=1)['blackboard']['markdown']
    except AssertionError as error:
        assert error.args[0][0] == 409, error
        return None
with ThreadPoolExecutor() as pool:
    results = list(pool.map(publish, ['first tab', 'second tab']))
assert sum(result is not None for result in results) == 1
assert call(student, code=code)['blackboard']['markdown'] in results
cleared = call(teacher, 'blackboard-publish', code=code, markdown='', boardVersion=2)['blackboard']
assert cleared['markdown'] == '' and cleared['version'] == 3
assert call(student, code=code)['blackboard'] == cleared
print('PASS: teacher-only blackboard, validation, persistent student/late-join views, room isolation, concurrent edit conflicts and clearing.')
