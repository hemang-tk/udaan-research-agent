from udaan_ranking.scoring import RELEVANCE_FLOOR, TOP_K, sigmoid, stratify


def test_sigmoid_bounds():
    assert sigmoid(0.0) == 0.5
    assert sigmoid(10.0) > 0.99
    assert sigmoid(-10.0) < 0.01


def test_stratify_sorts_desc_and_applies_floor():
    out = stratify([(0, 0.9), (1, 0.3), (2, 0.6)], apply_floor=True)
    assert [i for i, _ in out] == [0, 2]  # 0.3 < floor dropped
    assert RELEVANCE_FLOOR == 0.5


def test_stratify_without_floor_keeps_all_sorted():
    out = stratify([(0, 0.1), (1, 0.4)], apply_floor=False)
    assert [i for i, _ in out] == [1, 0]


def test_stratify_truncates_to_top_k():
    scored = [(i, i / 100) for i in range(30)]
    assert len(stratify(scored, apply_floor=False)) == TOP_K
