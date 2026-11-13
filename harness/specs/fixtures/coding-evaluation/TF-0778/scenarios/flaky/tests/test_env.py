import pytest


@pytest.fixture
def broken_fixture():
    raise RuntimeError('夹具在 setup 阶段故意报错（环境失败，不是断言失败）')


def test_env(broken_fixture):
    assert True
