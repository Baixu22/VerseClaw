from text import normalize


def test_normalize():
    assert normalize(' A ') == 'a'
