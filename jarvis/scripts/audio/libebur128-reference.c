#include <stdio.h>
#include <stdlib.h>
#include <math.h>
#include "ebur128.h"
int main(int argc,char**argv){
 if(argc<4)return 2;unsigned channels=atoi(argv[2]),rate=atoi(argv[3]);FILE*f=fopen(argv[1],"rb");if(!f)return 2;
 ebur128_state*s=ebur128_init(channels,rate,EBUR128_MODE_I|EBUR128_MODE_TRUE_PEAK|EBUR128_MODE_SAMPLE_PEAK);if(!s)return 3;
 float buffer[32768];size_t count;while((count=fread(buffer,sizeof(float),32768,f)))if(ebur128_add_frames_float(s,buffer,count/channels)!=0)return 4;
 double integrated,peak=0,sample=0,value;ebur128_loudness_global(s,&integrated);
 for(unsigned c=0;c<channels;c++){ebur128_true_peak(s,c,&value);if(value>peak)peak=value;ebur128_sample_peak(s,c,&value);if(value>sample)sample=value;}
 printf("{\"integratedLufs\":%.8f,\"truePeakDbtp\":%.8f,\"samplePeakDbfs\":%.8f}\n",integrated,20*log10(peak),20*log10(sample));
 ebur128_destroy(&s);fclose(f);return 0;
}
