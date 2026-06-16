import { Module }            from '@nestjs/common';
import { ScheduleModule }    from '@nestjs/schedule';
import { ListenerService }   from './listener.service';
@Module({
  imports:[ScheduleModule.forRoot()],
  providers:[ListenerService],
})
export class ListenerModule {}
