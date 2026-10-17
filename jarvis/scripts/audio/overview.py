#!/usr/bin/env python3
"""Plot retained full-file measurements; no audio or network work."""
import json,textwrap
from pathlib import Path
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
folder=Path('docs/audio-evidence')
corpus={x['id']:x for x in json.loads((folder/'corpus.json').read_text())['tracks']}
rows=json.loads((folder/'corpus-measurements.json').read_text())['tracks']
labels=['\n'.join(textwrap.wrap(corpus[x['id']]['metadata']['title'],width=31)) for x in rows]
old=[next(v['activePercent'] for v in x['variants'] if v['variant']=='baseline100') for x in rows]
new=[next(v['activePercent'] for v in x['variants'] if v['variant']=='new-volume50') for x in rows]
fig,ax=plt.subplots(figsize=(10,6));fig.subplots_adjust(left=.32,right=.96,bottom=.21,top=.84)
positions=list(range(len(rows)));ax.barh(positions,old,color='#d97a36',height=.45,label='Previous limiter before user volume')
ax.scatter(new,positions,color='#16826d',s=60,zorder=3,label='New guard after 50% user volume')
for i,value in enumerate(old):ax.text(value+.9,i,f'{value:.2f}%',va='center',fontsize=10)
ax.set_yticks(positions,labels);ax.invert_yaxis();ax.set_xlim(-2,85);ax.set_xlabel('Frames with protective gain below 0.999 (%)')
ax.spines[['top','right','left']].set_visible(False);ax.grid(axis='x',alpha=.2);ax.set_axisbelow(True)
fig.suptitle('Protection activity at 50% player volume',fontsize=16,x=.32,ha='left',y=.96)
fig.text(.32,.88,'Six verified originals · decoded offline · slider gain = 0.25',fontsize=10,color='#555555')
ax.legend(loc='upper center',bbox_to_anchor=(.5,-.12),frameon=False,fontsize=9,ncol=2)
fig.text(.04,.035,'Previous post-volume activity equals its full-level activity: the later gain cannot undo limiter modulation.\nNew pre-guard-volume measurements are rendered full-file results. This measures software processing, not listening preference.',fontsize=9,color='#555555')
fig.savefig(folder/'protection-activity.svg');fig.savefig(folder/'protection-activity.png',dpi=160);plt.close(fig)
