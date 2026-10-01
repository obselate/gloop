import argparse
import json
from pathlib import Path
import textwrap

import matplotlib

matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.ticker import MaxNLocator


BACKGROUND = '#0d1117'
PANEL = '#161b22'
BORDER = '#30363d'
TEXT = '#e6edf3'
MUTED = '#9da7b3'
GREEN = '#3fb950'
BLUE = '#58a6ff'
SCENARIOS = {
    'list100': '100 files / list',
    'list100000': '100,000 files / list',
    'tiles100000': '100,000 files / tiles',
    'preview3png': 'Three 4096 x 4096 PNGs / preview',
}
METRICS = {
    'first_buffer_ms': ('First Wayland buffer', 'ms', 1,
                        'Launch to first buffer attachment. Includes trace overhead. Does not measure readiness.'),
    'cpu_first_3s_ms': ('CPU time / first 3 seconds', 'ms', 0,
                        'Owned cgroup CPU, including warmed desktop services and supervisor overhead. Several cores can run at once.'),
    'rss_mib': ('Resident memory / 5 seconds', 'MiB', 1,
                'Sum of owned process RSS. Shared pages can be counted more than once. GPU excluded.'),
    'pss_mib': ('Proportional memory / 5 seconds', 'MiB', 1,
                'Sum of owned process PSS. Shared pages divided between processes. GPU excluded.'),
    'gpu_mib': ('GPU memory / 5 seconds', 'MiB', 0,
                'NVIDIA per-process sample. Compositor excluded. Missing telemetry is N/A, never zero.'),
    'main_process_vmhwm_mib': ('GUI process high-water RSS / first 5 seconds', 'MiB', 1,
                     'Main GUI process VmHWM. Helpers are excluded. See process-tree peak for combined usage.'),
    'scope_peak_rss_mib': ('Process-tree peak RSS / first 5 seconds', 'MiB', 1,
                         'Maximum simultaneous owned-process RSS sampled about every 100 ms. Can miss short peaks. GPU excluded.'),
    'cpu_3_to_5_percent': ('CPU activity / seconds 3 to 5', '% of one core', 1,
                         'A fixed sample window. Large folders can still be loading. 0.0% is rounded to the displayed precision.'),
}
SHORT_LABELS = ['First buffer\nms', 'CPU, first 3s\nms', 'RSS\nMiB', 'PSS\nMiB',
                'GPU\nMiB', 'GUI peak\nMiB', 'Tree peak\nMiB', 'CPU, 3 to 5s\n% of one core']


def comparable_rows(rows, key):
    return [row for row in rows if row.get('metrics_comparable', {}).get(key, row.get('comparable', False))
            and row.get(key) is not None]


def position(rows, key, decimals):
    gloop = next((row for row in rows if row['app'] == 'Gloop'), None)
    if not gloop:
        return None
    rank = 1 + sum(round(row[key], decimals) < round(gloop[key], decimals) for row in rows)
    tied = sum(round(row[key], decimals) == round(gloop[key], decimals) for row in rows) > 1
    return gloop, f'{rank}/{len(rows)}' + (' tied' if tied else '')


def base_card(title, subtitle):
    figure = plt.figure(figsize=(18, 14), dpi=120, facecolor=BACKGROUND)
    figure.text(.045, .958, title, color=TEXT, fontsize=26, weight='bold', va='top')
    figure.text(.045, .919, subtitle, color=MUTED, fontsize=12, va='top')
    figure.text(.955, .957, 'GLOOP  /  FILE MANAGERS', color=GREEN, fontsize=11,
                weight='bold', ha='right', va='top')
    return figure


def save_card(figure, target, footer):
    figure.text(.045, .04, footer, color=MUTED, fontsize=10, va='bottom')
    figure.text(.045, .022, '2026-10-01  |  Ryzen 7 3700X  |  RTX 3080  |  CachyOS  |  Method and raw data: README Performance',
                color=MUTED, fontsize=9, va='bottom')
    figure.savefig(target, facecolor=BACKGROUND)
    plt.close(figure)


def chart(axis, rows, key, unit, decimals, title):
    usable = comparable_rows(rows, key)
    usable.sort(key=lambda row: (round(row[key], decimals), row['app'].casefold()))
    missing = [row['app'] for row in rows if row not in usable]
    axis.set_facecolor(PANEL)
    for spine in axis.spines.values():
        spine.set_color(BORDER)
    axis.spines['left'].set_visible(False)
    axis.spines['top'].set_visible(False)
    axis.spines['right'].set_visible(False)
    axis.set_axisbelow(True)
    axis.grid(axis='x', color=BORDER, alpha=.65, linewidth=.7)
    axis.tick_params(axis='both', colors=MUTED, length=0, labelsize=10)
    axis.xaxis.set_major_locator(MaxNLocator(4, min_n_ticks=2))
    if not usable:
        axis.set_xticks([])
        axis.set_yticks([])
        axis.text(.5, .5, 'No comparable measurements', color=MUTED,
                  ha='center', va='center', transform=axis.transAxes, fontsize=14)
    else:
        maximum = max(row.get('ranges', {}).get(key, {}).get('max', row[key])
                      for row in usable)
        axis.set_xlim(0, max(maximum, .1) * 1.28)
        axis.set_ylim(len(usable) - .4, -.8)
        axis.set_yticks(range(len(usable)),
                       [row['app'] + (' *' if row.get('ready_at_5s') is False else '')
                        for row in usable], fontsize=11)
        for index, row in enumerate(usable):
            value = row[key]
            color = GREEN if row['app'] == 'Gloop' else BLUE
            axis.barh(index, value, height=.49, color=color, alpha=1 if color == GREEN else .65)
            spread = row.get('ranges', {}).get(key)
            if spread:
                axis.errorbar(value, index,
                              xerr=[[max(0, value - spread['min'])],
                                    [max(0, spread['max'] - value)]],
                              fmt='none', ecolor=TEXT, elinewidth=.8, capsize=2, capthick=.8)
            label_x = max(spread['max'] if spread else value, maximum * .009) + maximum * .018
            axis.text(label_x, index,
                      f'{value:,.{decimals}f}', va='center', color=color if color == GREEN else TEXT,
                      fontsize=10, weight='bold' if color == GREEN else 'normal')
        for label, row in zip(axis.get_yticklabels(), usable):
            if row['app'] == 'Gloop':
                label.set_color(GREEN)
                label.set_weight('bold')
        ranking = position(usable, key, decimals)
        if ranking:
            axis.text(1, 1.06, f'Gloop {ranking[1]}', ha='right', va='bottom', color=GREEN,
                      transform=axis.transAxes, fontsize=11, weight='bold')
    axis.set_title(title, loc='left', color=TEXT, fontsize=14, weight='bold', pad=28)
    axis.set_xlabel(unit, color=MUTED, fontsize=10, loc='right')
    if missing:
        text = 'N/A: ' + ', '.join(missing)
        axis.text(0, -.12, '\n'.join(textwrap.wrap(text, 66)), color=MUTED, fontsize=8,
                  transform=axis.transAxes, va='top')


def metric_cards(rows, output):
    for key, (title, unit, decimals, note) in METRICS.items():
        figure = base_card(title, 'Observed median positions, lower values first. Gloop in green. Three warm launches. Whiskers show the range.')
        axes = figure.subplots(2, 2)
        figure.subplots_adjust(left=.15, right=.94, bottom=.145, top=.84, hspace=.49, wspace=.48)
        for axis, (scenario, label) in zip(axes.flat, SCENARIOS.items()):
            chart(axis, [row for row in rows if row['scenario'] == scenario],
                  key, unit, decimals, label)
        save_card(figure, output / f'{key}.png', note + '\n* Workload still loading at the five-second capture. Positions describe this cohort, not universal performance.')


def footprint_card(apps, output):
    rows = [{'app': app['name'], 'executable_mib': app['binary_bytes'] / 1048576,
             'comparable': True} for app in apps if app.get('binary_bytes') is not None]
    figure = base_card('Launch executable size', 'Dependencies, plugins, assets and runtime libraries are excluded. This does not rank complete installation size.')
    axis = figure.add_axes((.19, .19, .7, .65))
    chart(axis, rows, 'executable_mib', 'MiB', 2, 'Exact launch executable used for each application')
    save_card(figure, output / 'executable_size.png', 'Gloop includes its application libraries and required assets in one executable. Other managers use external dependencies.')


def overview_card(rows, output):
    figure = base_card('Where Gloop lands', 'Median values and observed positions among validated cases. Lower values first. Ties use the displayed precision.')
    axis = figure.add_axes((.045, .27, .91, .5))
    axis.set_axis_off()
    cells = []
    for scenario, label in SCENARIOS.items():
        values = []
        for key, (_, _, decimals, _) in METRICS.items():
            ranking = position(comparable_rows([row for row in rows if row['scenario'] == scenario], key), key, decimals)
            values.append(f'{ranking[0][key]:,.{decimals}f}\n{ranking[1]}' if ranking else 'N/A')
        cells.append(['\n'.join(textwrap.wrap(label, 24)), *values])
    table = axis.table(cellText=cells, colLabels=['Workload', *SHORT_LABELS],
                       colWidths=[.2, *([.1] * 8)], bbox=[0, 0, 1, 1], cellLoc='center')
    table.auto_set_font_size(False)
    table.set_fontsize(13)
    for (row, column), cell in table.get_celld().items():
        cell.set_facecolor(PANEL)
        cell.set_edgecolor(BORDER)
        cell.set_linewidth(.6)
        cell.get_text().set_color(TEXT if row == 0 or column == 0 else GREEN)
        if row == 0 or column == 0:
            cell.get_text().set_weight('bold')
    save_card(figure, output / 'gloop_positions.png', 'Three warm launches per case. Individual metric cards show every competitor and min/max ranges.\nPositions describe this cohort. View layouts differ. Five-second samples can include loading. CPU, 3 to 5s is not necessarily idle.')


def coverage_card(rows, apps, output):
    figure = base_card('Benchmark coverage and versions', 'Same local folders and window size. Unsupported or unverified cases are excluded from metric positions.')
    axis = figure.add_axes((.045, .15, .91, .68))
    axis.set_axis_off()
    cells = []
    for app in apps:
        values = []
        for scenario in SCENARIOS:
            row = next((row for row in rows if row['app'] == app['name'] and row['scenario'] == scenario), {})
            values.append('Loading at 5s' if row.get('comparable') and row.get('ready_at_5s') is False
                          else 'Measured' if row.get('comparable') else 'Unverified' if row.get('n', 0) == 3 else 'N/A')
        cells.append([app['name'], app['version'], *values])
    table = axis.table(cellText=cells,
                       colLabels=['Application', 'Tested version', '100 / list', '100k / list', '100k / tiles', 'PNG preview'],
                       colWidths=[.24, .18, .145, .145, .145, .145], bbox=[0, 0, 1, 1], cellLoc='left')
    table.auto_set_font_size(False)
    table.set_fontsize(12)
    for (row, column), cell in table.get_celld().items():
        cell.set_facecolor(PANEL)
        cell.set_edgecolor(BORDER)
        cell.set_linewidth(.6)
        cell.get_text().set_color(TEXT if row == 0 else MUTED)
        if row == 0 or row > 0 and apps[row - 1]['name'] == 'Gloop':
            cell.get_text().set_weight('bold')
            cell.get_text().set_color(TEXT if row == 0 else GREEN)
    save_card(figure, output / 'coverage.png', 'N/A reasons and exact binary hashes are in the report and data files. Package versions can differ from the latest upstream release.')


def publish_card(apps, output):
    figure = base_card('Publish time / build provenance', 'Publish is toolchain specific. Prebuilt competitor packages do not have a measured source publish time.')
    axis = figure.add_axes((.09, .19, .82, .64))
    axis.set_axis_off()
    cells = []
    for app in apps:
        value = app.get('publish_time_s')
        cells.append([app['name'], f'{value:.3f} s' if value is not None else 'Not measured',
                      'NativeAOT Size / Ubuntu 24.04' if app['name'] == 'Gloop' else 'Prebuilt package or upstream archive'])
    table = axis.table(cellText=cells, colLabels=['Application', 'Publish time', 'Artifact source'],
                       colWidths=[.28, .2, .52], bbox=[0, 0, 1, 1], cellLoc='left')
    table.auto_set_font_size(False)
    table.set_fontsize(12)
    for (row, column), cell in table.get_celld().items():
        cell.set_facecolor(PANEL)
        cell.set_edgecolor(BORDER)
        cell.set_linewidth(.6)
        cell.get_text().set_color(TEXT if row == 0 else MUTED)
        if row == 0 or row > 0 and apps[row - 1]['name'] == 'Gloop':
            cell.get_text().set_weight('bold')
            cell.get_text().set_color(TEXT if row == 0 else GREEN)
    save_card(figure, output / 'publish_time.png', 'Gloop: prior same-day controlled observation, SDK 10.0.401, two CPUs, 8 GiB. Restore and packaging checks excluded. No cross-toolchain ranking.')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('summary', type=Path)
    parser.add_argument('manifest', type=Path)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    summary = json.loads(args.summary.read_text())
    manifest = json.loads(args.manifest.read_text())
    args.output.mkdir(parents=True, exist_ok=True)
    rows = summary['summaries'] if isinstance(summary, dict) else summary
    for row in rows:
        row['app'] = row.get('name', row['app'])
        row['ranges'] = {key: {'min': spread[0], 'max': spread[1]}
                         for key, spread in row.get('ranges', {}).items() if spread is not None}
    metric_cards(rows, args.output)
    overview_card(rows, args.output)
    footprint_card(manifest['apps'], args.output)
    coverage_card(rows, manifest['apps'], args.output)
    publish_card(manifest['apps'], args.output)


if __name__ == '__main__':
    main()
